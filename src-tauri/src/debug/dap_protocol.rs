use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::error::Error;
use std::fmt::{Display, Formatter};

pub const MAX_HEADER_BYTES: usize = 16 * 1024;
pub const DEFAULT_MAX_BODY_BYTES: usize = 8 * 1024 * 1024;
pub const DEFAULT_MAX_BUFFER_BYTES: usize = DEFAULT_MAX_BODY_BYTES + MAX_HEADER_BYTES;

const HEADER_TERMINATOR: &[u8] = b"\r\n\r\n";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum DapMessage {
    Request(DapRequest),
    Response(DapResponse),
    Event(DapEvent),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DapRequest {
    pub seq: u64,
    pub command: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub arguments: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DapResponse {
    pub seq: u64,
    pub request_seq: u64,
    pub success: bool,
    pub command: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DapEvent {
    pub seq: u64,
    pub event: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub statistics: Option<Value>,
}

impl DapMessage {
    fn validate(&self) -> Result<(), DapProtocolError> {
        match self {
            Self::Request(request) => validate_name("command", &request.command),
            Self::Response(response) => {
                if response.request_seq == 0 {
                    return Err(DapProtocolError::InvalidEnvelope(
                        "response request_seq must be greater than zero".to_string(),
                    ));
                }
                validate_name("command", &response.command)
            }
            Self::Event(event) => validate_name("event", &event.event),
        }
    }
}

fn validate_name(field: &str, value: &str) -> Result<(), DapProtocolError> {
    if value.trim().is_empty() {
        return Err(DapProtocolError::InvalidEnvelope(format!(
            "{field} must not be empty"
        )));
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DapProtocolError {
    InvalidLimits,
    BufferLimitExceeded { limit: usize, attempted: usize },
    HeaderTooLarge { limit: usize },
    InvalidHeader(String),
    MissingContentLength,
    DuplicateContentLength,
    InvalidContentLength(String),
    BodyTooLarge { limit: usize, declared: usize },
    InvalidJson(String),
    InvalidEnvelope(String),
}

impl Display for DapProtocolError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidLimits => write!(formatter, "invalid DAP decoder limits"),
            Self::BufferLimitExceeded { limit, attempted } => write!(
                formatter,
                "DAP buffer limit exceeded: attempted {attempted} bytes, limit {limit}"
            ),
            Self::HeaderTooLarge { limit } => {
                write!(formatter, "DAP header exceeds {limit} bytes")
            }
            Self::InvalidHeader(reason) => write!(formatter, "invalid DAP header: {reason}"),
            Self::MissingContentLength => write!(formatter, "DAP frame has no Content-Length"),
            Self::DuplicateContentLength => {
                write!(formatter, "DAP frame has duplicate Content-Length headers")
            }
            Self::InvalidContentLength(value) => {
                write!(formatter, "invalid DAP Content-Length: {value}")
            }
            Self::BodyTooLarge { limit, declared } => write!(
                formatter,
                "DAP body declares {declared} bytes, limit is {limit}"
            ),
            Self::InvalidJson(reason) => write!(formatter, "invalid DAP JSON: {reason}"),
            Self::InvalidEnvelope(reason) => write!(formatter, "invalid DAP envelope: {reason}"),
        }
    }
}

impl Error for DapProtocolError {}

pub fn encode_message(message: &DapMessage) -> Result<Vec<u8>, DapProtocolError> {
    encode_message_with_limit(message, DEFAULT_MAX_BODY_BYTES)
}

pub fn encode_message_with_limit(
    message: &DapMessage,
    max_body_bytes: usize,
) -> Result<Vec<u8>, DapProtocolError> {
    if max_body_bytes == 0 {
        return Err(DapProtocolError::InvalidLimits);
    }
    message.validate()?;
    let body = serde_json::to_vec(message)
        .map_err(|error| DapProtocolError::InvalidJson(error.to_string()))?;
    if body.len() > max_body_bytes {
        return Err(DapProtocolError::BodyTooLarge {
            limit: max_body_bytes,
            declared: body.len(),
        });
    }
    let header = format!("Content-Length: {}\r\n\r\n", body.len());
    let mut frame = Vec::with_capacity(header.len() + body.len());
    frame.extend_from_slice(header.as_bytes());
    frame.extend_from_slice(&body);
    Ok(frame)
}

#[derive(Debug)]
pub struct DapDecoder {
    buffer: Vec<u8>,
    max_body_bytes: usize,
    max_buffer_bytes: usize,
}

impl Default for DapDecoder {
    fn default() -> Self {
        Self::new()
    }
}

impl DapDecoder {
    pub fn new() -> Self {
        Self {
            buffer: Vec::new(),
            max_body_bytes: DEFAULT_MAX_BODY_BYTES,
            max_buffer_bytes: DEFAULT_MAX_BUFFER_BYTES,
        }
    }

    pub fn with_limits(
        max_body_bytes: usize,
        max_buffer_bytes: usize,
    ) -> Result<Self, DapProtocolError> {
        if max_body_bytes == 0
            || max_buffer_bytes < MAX_HEADER_BYTES
            || max_buffer_bytes < max_body_bytes
        {
            return Err(DapProtocolError::InvalidLimits);
        }
        Ok(Self {
            buffer: Vec::new(),
            max_body_bytes,
            max_buffer_bytes,
        })
    }

    pub fn buffered_len(&self) -> usize {
        self.buffer.len()
    }

    pub fn clear(&mut self) {
        self.buffer.clear();
    }

    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<DapMessage>, DapProtocolError> {
        let attempted = self.buffer.len().saturating_add(bytes.len());
        if attempted > self.max_buffer_bytes {
            self.buffer.clear();
            return Err(DapProtocolError::BufferLimitExceeded {
                limit: self.max_buffer_bytes,
                attempted,
            });
        }
        self.buffer.extend_from_slice(bytes);

        let result = self.decode_available();
        if result.is_err() {
            self.buffer.clear();
        }
        result
    }

    fn decode_available(&mut self) -> Result<Vec<DapMessage>, DapProtocolError> {
        let mut messages = Vec::new();
        loop {
            let Some(header_end) = find_subsequence(&self.buffer, HEADER_TERMINATOR) else {
                if self.buffer.len() > MAX_HEADER_BYTES {
                    return Err(DapProtocolError::HeaderTooLarge {
                        limit: MAX_HEADER_BYTES,
                    });
                }
                break;
            };
            if header_end > MAX_HEADER_BYTES {
                return Err(DapProtocolError::HeaderTooLarge {
                    limit: MAX_HEADER_BYTES,
                });
            }

            let body_length = parse_content_length(&self.buffer[..header_end])?;
            if body_length > self.max_body_bytes {
                return Err(DapProtocolError::BodyTooLarge {
                    limit: self.max_body_bytes,
                    declared: body_length,
                });
            }

            let body_start = header_end + HEADER_TERMINATOR.len();
            let frame_length = body_start
                .checked_add(body_length)
                .ok_or_else(|| DapProtocolError::InvalidContentLength(body_length.to_string()))?;
            if frame_length > self.max_buffer_bytes {
                return Err(DapProtocolError::BufferLimitExceeded {
                    limit: self.max_buffer_bytes,
                    attempted: frame_length,
                });
            }
            if self.buffer.len() < frame_length {
                break;
            }

            let message =
                serde_json::from_slice::<DapMessage>(&self.buffer[body_start..frame_length])
                    .map_err(|error| DapProtocolError::InvalidJson(error.to_string()))?;
            message.validate()?;
            messages.push(message);
            self.buffer.drain(..frame_length);
        }
        Ok(messages)
    }
}

fn parse_content_length(header: &[u8]) -> Result<usize, DapProtocolError> {
    let header = std::str::from_utf8(header)
        .map_err(|_| DapProtocolError::InvalidHeader("header is not UTF-8/ASCII".to_string()))?;
    let mut content_length = None;

    for line in header.split("\r\n") {
        if line.is_empty() {
            return Err(DapProtocolError::InvalidHeader(
                "empty line before header terminator".to_string(),
            ));
        }
        let (name, value) = line.split_once(':').ok_or_else(|| {
            DapProtocolError::InvalidHeader(format!("header line has no colon: {line}"))
        })?;
        let name = name.trim();
        let value = value.trim();
        if name.is_empty() || value.is_empty() {
            return Err(DapProtocolError::InvalidHeader(format!(
                "empty header name or value: {line}"
            )));
        }
        if name.eq_ignore_ascii_case("Content-Length") {
            if content_length.is_some() {
                return Err(DapProtocolError::DuplicateContentLength);
            }
            if !value.bytes().all(|byte| byte.is_ascii_digit()) {
                return Err(DapProtocolError::InvalidContentLength(value.to_string()));
            }
            let parsed = value
                .parse::<usize>()
                .map_err(|_| DapProtocolError::InvalidContentLength(value.to_string()))?;
            content_length = Some(parsed);
        }
    }

    content_length.ok_or(DapProtocolError::MissingContentLength)
}

fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn request(seq: u64) -> DapMessage {
        DapMessage::Request(DapRequest {
            seq,
            command: "initialize".to_string(),
            arguments: Some(json!({"clientID": "codeflow", "linesStartAt1": true})),
        })
    }

    #[test]
    fn encodes_content_length_frame() {
        let message = request(1);
        let frame = encode_message(&message).expect("encode request");
        let delimiter = find_subsequence(&frame, HEADER_TERMINATOR).expect("header terminator");
        let header = std::str::from_utf8(&frame[..delimiter]).expect("ASCII header");
        let body = &frame[delimiter + HEADER_TERMINATOR.len()..];
        assert_eq!(header, format!("Content-Length: {}", body.len()));
        assert_eq!(serde_json::from_slice::<DapMessage>(body).unwrap(), message);
    }

    #[test]
    fn incrementally_decodes_every_byte_boundary() {
        let message = request(7);
        let frame = encode_message(&message).unwrap();
        let mut decoder = DapDecoder::new();
        let mut decoded = Vec::new();
        for byte in frame {
            decoded.extend(decoder.push(&[byte]).unwrap());
        }
        assert_eq!(decoded, vec![message]);
        assert_eq!(decoder.buffered_len(), 0);
    }

    #[test]
    fn decodes_multiple_frames_from_one_chunk() {
        let messages = vec![
            request(1),
            DapMessage::Response(DapResponse {
                seq: 2,
                request_seq: 1,
                success: true,
                command: "initialize".to_string(),
                message: None,
                body: Some(json!({"supportsConfigurationDoneRequest": true})),
            }),
            DapMessage::Event(DapEvent {
                seq: 3,
                event: "initialized".to_string(),
                body: None,
                statistics: None,
            }),
        ];
        let bytes = messages
            .iter()
            .flat_map(|message| encode_message(message).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(DapDecoder::new().push(&bytes).unwrap(), messages);
    }

    #[test]
    fn accepts_adapter_statistics_on_events_without_relaxing_other_fields() {
        let body = br#"{"seq":4,"type":"event","event":"exited","body":{"exitCode":0},"statistics":{"targetTime":0.25}}"#;
        let frame = [
            format!("Content-Length: {}\r\n\r\n", body.len()).into_bytes(),
            body.to_vec(),
        ]
        .concat();
        let messages = DapDecoder::new().push(&frame).unwrap();
        assert_eq!(messages.len(), 1);
        assert!(matches!(
            &messages[0],
            DapMessage::Event(DapEvent { statistics: Some(value), .. })
                if value.get("targetTime").and_then(Value::as_f64) == Some(0.25)
        ));
    }

    #[test]
    fn retains_partial_body_until_complete() {
        let frame = encode_message(&request(1)).unwrap();
        let split = frame.len() - 3;
        let mut decoder = DapDecoder::new();
        assert!(decoder.push(&frame[..split]).unwrap().is_empty());
        assert_eq!(decoder.buffered_len(), split);
        assert_eq!(decoder.push(&frame[split..]).unwrap(), vec![request(1)]);
    }

    #[test]
    fn rejects_missing_duplicate_and_invalid_content_length() {
        for (frame, expected) in [
            (
                b"Content-Type: application/json\r\n\r\n{}".as_slice(),
                DapProtocolError::MissingContentLength,
            ),
            (
                b"Content-Length: 2\r\ncontent-length: 2\r\n\r\n{}".as_slice(),
                DapProtocolError::DuplicateContentLength,
            ),
            (
                b"Content-Length: -1\r\n\r\n".as_slice(),
                DapProtocolError::InvalidContentLength("-1".to_string()),
            ),
        ] {
            assert_eq!(DapDecoder::new().push(frame).unwrap_err(), expected);
        }
    }

    #[test]
    fn rejects_declared_body_before_allocating_it() {
        let mut decoder = DapDecoder::with_limits(32, MAX_HEADER_BYTES).unwrap();
        assert_eq!(
            decoder.push(b"Content-Length: 33\r\n\r\n").unwrap_err(),
            DapProtocolError::BodyTooLarge {
                limit: 32,
                declared: 33,
            }
        );
        assert_eq!(decoder.buffered_len(), 0);
    }

    #[test]
    fn rejects_header_and_buffer_limit_overflow() {
        let mut decoder = DapDecoder::new();
        assert_eq!(
            decoder.push(&vec![b'a'; MAX_HEADER_BYTES + 1]).unwrap_err(),
            DapProtocolError::HeaderTooLarge {
                limit: MAX_HEADER_BYTES,
            }
        );

        let mut limited = DapDecoder::with_limits(16, MAX_HEADER_BYTES).unwrap();
        assert_eq!(
            limited.push(&vec![b'a'; MAX_HEADER_BYTES + 1]).unwrap_err(),
            DapProtocolError::BufferLimitExceeded {
                limit: MAX_HEADER_BYTES,
                attempted: MAX_HEADER_BYTES + 1,
            }
        );
    }

    #[test]
    fn rejects_invalid_json_and_invalid_envelope() {
        let invalid_json = b"Content-Length: 1\r\n\r\n{";
        assert!(matches!(
            DapDecoder::new().push(invalid_json),
            Err(DapProtocolError::InvalidJson(_))
        ));

        let empty_event = DapMessage::Event(DapEvent {
            seq: 0,
            event: "".to_string(),
            body: None,
            statistics: None,
        });
        assert!(matches!(
            encode_message(&empty_event),
            Err(DapProtocolError::InvalidEnvelope(_))
        ));
    }

    #[test]
    fn rejects_unknown_envelope_fields() {
        let body = br#"{"seq":1,"type":"event","event":"stopped","unexpected":true}"#;
        let frame = format!("Content-Length: {}\r\n\r\n", body.len())
            .bytes()
            .chain(body.iter().copied())
            .collect::<Vec<_>>();
        assert!(matches!(
            DapDecoder::new().push(&frame),
            Err(DapProtocolError::InvalidJson(_))
        ));
    }
}
