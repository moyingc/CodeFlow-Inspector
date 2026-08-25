import type {
  DeepWebGeneratedVectorReport,
  DeepWebModelBaseline,
  DeepWebSupervisedReport,
  DeepWebTrainableHeadParameters,
  DeepWebTrainableHeadReport,
  DeepWebVectorLabel,
} from "@/src/lib/analysis/types";

const DIMENSIONS = [
  "lexical",
  "ast",
  "type",
  "control_flow",
  "data_flow",
  "dependency",
  "runtime",
  "benchmark",
  "security",
  "stability",
  "language",
  "environment",
  "hardware",
  "repair",
] as const;

const LABELS: DeepWebVectorLabel[] = [
  "safe",
  "flow_warning",
  "security_risk",
  "stability_risk",
  "performance_hotspot",
  "repair_candidate",
];

const HIDDEN_SIZE = 12;
const MAX_EPOCHS = 36;
const BASE_LEARNING_RATE = 0.032;

type TrainingSample = {
  input: number[];
  labelIndex: number;
  weight: number;
};

export function trainDeepWebHead(
  vectors: DeepWebGeneratedVectorReport[],
  supervised: DeepWebSupervisedReport,
  baseline?: DeepWebModelBaseline | null,
): DeepWebTrainableHeadReport {
  const vectorById = new Map(vectors.map((vector) => [vector.id, vector]));
  const samples = supervised.assignments
    .filter((assignment) => assignment.trustScore >= 62 && assignment.consensusScore >= 58)
    .map((assignment) => {
      const vector = vectorById.get(assignment.vectorId);
      const labelIndex = LABELS.indexOf(assignment.teacherLabel);
      if (!vector || labelIndex < 0) return null;
      return {
        input: DIMENSIONS.map((dimension) => clamp01(vector.dimensions[dimension] ?? 0)),
        labelIndex,
        weight: clamp01((assignment.trustScore * 0.55 + assignment.consensusScore * 0.45) / 100),
      };
    })
    .filter((sample): sample is TrainingSample => Boolean(sample));
  const classCount = new Set(samples.map((sample) => sample.labelIndex)).size;
  const inherited = compatibleParameters(baseline?.networkParameters) ? baseline?.networkParameters : undefined;
  const initial = cloneParameters(inherited ?? initializeParameters());
  const training = samples.filter((_, index) => index % 5 !== 0);
  const validation = samples.filter((_, index) => index % 5 === 0);
  const validationSet = validation.length ? validation : training.slice(-Math.min(4, training.length));
  const trainLossBefore = averageLoss(initial, training);
  const validationLossBefore = averageLoss(initial, validationSet);

  if (training.length < 8 || classCount < 2) {
    return {
      status: "warming",
      architecture: "14x12x6",
      trainingSampleCount: training.length,
      validationSampleCount: validationSet.length,
      classCount,
      epochCount: 0,
      learningRate: BASE_LEARNING_RATE,
      trainLossBefore: round(trainLossBefore),
      trainLossAfter: round(trainLossBefore),
      validationLossBefore: round(validationLossBefore),
      validationLossAfter: round(validationLossBefore),
      improvement: 0,
      inherited: Boolean(inherited),
      parameters: initial,
      evidence: [
        `可信监督样本 ${samples.length}，训练 ${training.length}，验证 ${validationSet.length}，类别 ${classCount}/6。`,
        "样本或类别不足，未执行反向传播，保持候选层关闭。",
      ],
      next: "至少积累 8 个训练样本和 2 个老师类别；进入稳定模型前仍需跨项目验证。",
    };
  }

  let parameters = cloneParameters(initial);
  let bestParameters = cloneParameters(initial);
  let bestValidationLoss = validationLossBefore || Number.POSITIVE_INFINITY;
  let epochCount = 0;
  let patience = 0;

  for (let epoch = 0; epoch < MAX_EPOCHS; epoch += 1) {
    const learningRate = BASE_LEARNING_RATE / Math.sqrt(1 + epoch * 0.12);
    training.forEach((sample) => trainSample(parameters, sample, learningRate));
    epochCount = epoch + 1;
    const validationLoss = averageLoss(parameters, validationSet);
    if (validationLoss + 0.0005 < bestValidationLoss) {
      bestValidationLoss = validationLoss;
      bestParameters = cloneParameters(parameters);
      patience = 0;
    } else {
      patience += 1;
      if (patience >= 6) break;
    }
  }

  parameters = bestParameters;
  const trainLossAfter = averageLoss(parameters, training);
  const validationLossAfter = averageLoss(parameters, validationSet);
  const improvement = validationLossBefore > 0 ? (validationLossBefore - validationLossAfter) / validationLossBefore : 0;
  const validated =
    samples.length >= 18 &&
    classCount >= 3 &&
    validationSet.length >= 3 &&
    improvement >= 0.04 &&
    validationLossAfter <= trainLossAfter * 1.45 &&
    supervised.trustScore >= 68 &&
    supervised.consensusRate >= 64;

  return {
    status: validated ? "validated_candidate" : "trained_candidate",
    architecture: "14x12x6",
    trainingSampleCount: training.length,
    validationSampleCount: validationSet.length,
    classCount,
    epochCount,
    learningRate: BASE_LEARNING_RATE,
    trainLossBefore: round(trainLossBefore),
    trainLossAfter: round(trainLossAfter),
    validationLossBefore: round(validationLossBefore),
    validationLossAfter: round(validationLossAfter),
    improvement: Math.max(0, Math.round(improvement * 100)),
    inherited: Boolean(inherited),
    parameters,
    evidence: [
      `14 -> 12 -> 6 本地 MLP 完成 ${epochCount} 个 epoch；可信样本 ${samples.length}，类别 ${classCount}/6。`,
      `训练 loss ${round(trainLossBefore)} -> ${round(trainLossAfter)}；验证 loss ${round(validationLossBefore)} -> ${round(validationLossAfter)}。`,
      validated
        ? "独立验证门通过，MLP 仅作为融合候选参与推理；模型版本仍需总回放门晋级。"
        : "未通过完整验证门，参数已保存但不允许替换稳定父模型。",
    ],
    next: "用真实故障复现、修复验证和 benchmark 扩大验证集，并监控类别不平衡和跨项目回归。",
  };
}

export function scoreDeepWebHead(
  parameters: DeepWebTrainableHeadParameters,
  dimensions: Record<string, number>,
): Record<DeepWebVectorLabel, number> {
  const scores = forward(parameters, parameters.dimensionOrder.map((dimension) => clamp01(dimensions[dimension] ?? 0))).probabilities;
  return LABELS.reduce(
    (acc, label, index) => {
      acc[label] = round(scores[index] ?? 0);
      return acc;
    },
    {} as Record<DeepWebVectorLabel, number>,
  );
}

function trainSample(parameters: DeepWebTrainableHeadParameters, sample: TrainingSample, learningRate: number) {
  const { hidden, probabilities } = forward(parameters, sample.input);
  const outputError = probabilities.map((value, index) => (value - Number(index === sample.labelIndex)) * sample.weight);
  const hiddenError = hidden.map((value, hiddenIndex) => {
    if (value <= 0) return 0;
    return parameters.hiddenOutputWeights[hiddenIndex].reduce(
      (sum, weight, outputIndex) => sum + weight * outputError[outputIndex],
      0,
    );
  });

  parameters.hiddenOutputWeights.forEach((weights, hiddenIndex) => {
    weights.forEach((weight, outputIndex) => {
      weights[outputIndex] = weight - learningRate * (hidden[hiddenIndex] * outputError[outputIndex] + weight * 0.0004);
    });
  });
  parameters.outputBias.forEach((bias, outputIndex) => {
    parameters.outputBias[outputIndex] = bias - learningRate * outputError[outputIndex];
  });
  parameters.inputHiddenWeights.forEach((weights, inputIndex) => {
    weights.forEach((weight, hiddenIndex) => {
      weights[hiddenIndex] = weight - learningRate * (sample.input[inputIndex] * hiddenError[hiddenIndex] + weight * 0.0004);
    });
  });
  parameters.hiddenBias.forEach((bias, hiddenIndex) => {
    parameters.hiddenBias[hiddenIndex] = bias - learningRate * hiddenError[hiddenIndex];
  });
}

function forward(parameters: DeepWebTrainableHeadParameters, input: number[]) {
  const hidden = parameters.hiddenBias.map((bias, hiddenIndex) =>
    Math.max(
      0,
      bias + input.reduce((sum, value, inputIndex) => sum + value * parameters.inputHiddenWeights[inputIndex][hiddenIndex], 0),
    ),
  );
  const logits = parameters.outputBias.map(
    (bias, outputIndex) =>
      bias + hidden.reduce((sum, value, hiddenIndex) => sum + value * parameters.hiddenOutputWeights[hiddenIndex][outputIndex], 0),
  );
  const maxLogit = Math.max(...logits);
  const exponentials = logits.map((value) => Math.exp(value - maxLogit));
  const sum = exponentials.reduce((total, value) => total + value, 0) || 1;
  return { hidden, probabilities: exponentials.map((value) => value / sum) };
}

function averageLoss(parameters: DeepWebTrainableHeadParameters, samples: TrainingSample[]) {
  if (!samples.length) return 0;
  return (
    samples.reduce((sum, sample) => {
      const probability = forward(parameters, sample.input).probabilities[sample.labelIndex] ?? 1e-8;
      return sum - Math.log(Math.max(1e-8, probability)) * sample.weight;
    }, 0) / samples.reduce((sum, sample) => sum + sample.weight, 0)
  );
}

function initializeParameters(): DeepWebTrainableHeadParameters {
  return {
    architecture: "14x12x6",
    dimensionOrder: [...DIMENSIONS],
    labelOrder: [...LABELS],
    inputHiddenWeights: DIMENSIONS.map((_, inputIndex) =>
      Array.from({ length: HIDDEN_SIZE }, (_, hiddenIndex) => deterministicWeight(inputIndex, hiddenIndex, 1)),
    ),
    hiddenBias: Array.from({ length: HIDDEN_SIZE }, () => 0),
    hiddenOutputWeights: Array.from({ length: HIDDEN_SIZE }, (_, hiddenIndex) =>
      LABELS.map((_, outputIndex) => deterministicWeight(hiddenIndex, outputIndex, 7)),
    ),
    outputBias: LABELS.map(() => 0),
  };
}

function deterministicWeight(left: number, right: number, salt: number) {
  return ((((left + 1) * 37 + (right + 1) * 19 + salt * 13) % 31) - 15) / 100;
}

function compatibleParameters(
  parameters?: DeepWebTrainableHeadParameters,
): parameters is DeepWebTrainableHeadParameters {
  return Boolean(
    parameters &&
      parameters.architecture === "14x12x6" &&
      parameters.dimensionOrder.length === DIMENSIONS.length &&
      parameters.labelOrder.join("|") === LABELS.join("|") &&
      parameters.inputHiddenWeights.length === DIMENSIONS.length &&
      parameters.hiddenOutputWeights.length === HIDDEN_SIZE,
  );
}

function cloneParameters(parameters: DeepWebTrainableHeadParameters): DeepWebTrainableHeadParameters {
  return {
    ...parameters,
    dimensionOrder: [...parameters.dimensionOrder],
    labelOrder: [...parameters.labelOrder],
    inputHiddenWeights: parameters.inputHiddenWeights.map((row) => [...row]),
    hiddenBias: [...parameters.hiddenBias],
    hiddenOutputWeights: parameters.hiddenOutputWeights.map((row) => [...row]),
    outputBias: [...parameters.outputBias],
  };
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function round(value: number) {
  return Math.round(value * 10000) / 10000;
}
