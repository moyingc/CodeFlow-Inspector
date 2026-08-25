use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DebugSessionState {
    Created,
    AdapterStarted,
    Initialized,
    Configured,
    Running,
    Stopped,
    Terminated,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DebugSessionAction {
    StartAdapter,
    Initialize,
    Configure,
    Launch,
    Stop,
    Continue,
    Step,
    Terminate,
    Fail,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugSourceBreakpoint {
    pub path: String,
    pub line: usize,
    pub condition: Option<String>,
    pub hit_condition: Option<String>,
    pub verified: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugVariableSnapshot {
    pub name: String,
    pub type_name: String,
    pub value_preview: String,
    pub variables_reference: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugStopSnapshot {
    pub reason: String,
    pub thread_id: u64,
    pub frame_id: u64,
    pub function_name: String,
    pub path: String,
    pub line: usize,
    pub variables: Vec<DebugVariableSnapshot>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugEventSnapshot {
    pub kind: String,
    pub at_ms: u64,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugSessionRecord {
    pub id: String,
    pub project_id: String,
    pub adapter: String,
    pub state: DebugSessionState,
    pub breakpoints: Vec<DebugSourceBreakpoint>,
    pub last_stop: Option<DebugStopSnapshot>,
    pub event_log: Vec<DebugEventSnapshot>,
    pub failure: Option<String>,
}

impl DebugSessionRecord {
    pub fn apply(&mut self, action: DebugSessionAction) -> Result<DebugSessionState, String> {
        let next = match (self.state, action) {
            (_, DebugSessionAction::Fail) => DebugSessionState::Failed,
            (DebugSessionState::Created, DebugSessionAction::StartAdapter) => {
                DebugSessionState::AdapterStarted
            }
            (DebugSessionState::AdapterStarted, DebugSessionAction::Initialize) => {
                DebugSessionState::Initialized
            }
            (DebugSessionState::Initialized, DebugSessionAction::Configure) => {
                DebugSessionState::Configured
            }
            (DebugSessionState::Configured, DebugSessionAction::Launch) => {
                DebugSessionState::Running
            }
            (DebugSessionState::Running, DebugSessionAction::Stop) => DebugSessionState::Stopped,
            (
                DebugSessionState::Stopped,
                DebugSessionAction::Continue | DebugSessionAction::Step,
            ) => DebugSessionState::Running,
            (
                DebugSessionState::Running | DebugSessionState::Stopped,
                DebugSessionAction::Terminate,
            ) => DebugSessionState::Terminated,
            (DebugSessionState::Terminated | DebugSessionState::Failed, _) => {
                return Err("debug session is already closed".to_string())
            }
            (state, action) => {
                return Err(format!(
                    "debug action {action:?} is invalid while session is {state:?}"
                ))
            }
        };
        self.state = next;
        Ok(next)
    }
}

#[derive(Default)]
pub struct DebugSessionRegistry {
    sessions: BTreeMap<String, DebugSessionRecord>,
}

impl DebugSessionRegistry {
    pub fn insert(&mut self, session: DebugSessionRecord) -> Result<(), String> {
        if self.sessions.contains_key(&session.id) {
            return Err("debug session id already exists".to_string());
        }
        self.sessions.insert(session.id.clone(), session);
        Ok(())
    }

    pub fn get(&self, id: &str) -> Option<&DebugSessionRecord> {
        self.sessions.get(id)
    }

    pub fn get_mut(&mut self, id: &str) -> Option<&mut DebugSessionRecord> {
        self.sessions.get_mut(id)
    }

    pub fn remove(&mut self, id: &str) -> Option<DebugSessionRecord> {
        self.sessions.remove(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session() -> DebugSessionRecord {
        DebugSessionRecord {
            id: "debug-1".to_string(),
            project_id: "project-1".to_string(),
            adapter: "python".to_string(),
            state: DebugSessionState::Created,
            breakpoints: vec![],
            last_stop: None,
            event_log: vec![],
            failure: None,
        }
    }

    #[test]
    fn accepts_the_full_debug_session_lifecycle() {
        let mut value = session();
        for action in [
            DebugSessionAction::StartAdapter,
            DebugSessionAction::Initialize,
            DebugSessionAction::Configure,
            DebugSessionAction::Launch,
            DebugSessionAction::Stop,
            DebugSessionAction::Step,
            DebugSessionAction::Stop,
            DebugSessionAction::Continue,
            DebugSessionAction::Terminate,
        ] {
            value.apply(action).expect("valid transition");
        }
        assert_eq!(value.state, DebugSessionState::Terminated);
    }

    #[test]
    fn rejects_commands_before_initialization_and_after_termination() {
        let mut value = session();
        assert!(value.apply(DebugSessionAction::Launch).is_err());
        value
            .apply(DebugSessionAction::Fail)
            .expect("failure transition");
        assert!(value.apply(DebugSessionAction::Continue).is_err());
    }

    #[test]
    fn registry_rejects_cross_session_id_reuse() {
        let mut registry = DebugSessionRegistry::default();
        registry.insert(session()).expect("first session");
        assert!(registry.insert(session()).is_err());
        assert_eq!(registry.get("debug-1").unwrap().project_id, "project-1");
    }
}
