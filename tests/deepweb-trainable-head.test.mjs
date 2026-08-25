import assert from "node:assert/strict";
import test from "node:test";

import {
  scoreDeepWebHead,
  trainDeepWebHead,
} from "../src/lib/library/deepweb-trainable-head.ts";

test("DeepWeb 14x12x6 head performs real supervised optimization", () => {
  const labels = ["security_risk", "stability_risk", "performance_hotspot"];
  const signals = ["security", "stability", "benchmark"];
  const vectors = [];
  const assignments = [];

  labels.forEach((label, classIndex) => {
    for (let index = 0; index < 10; index += 1) {
      const id = `vector-${classIndex}-${index}`;
      vectors.push({
        id,
        sourceTable: "project_functions",
        sourceId: id,
        sourceName: id,
        pseudoLabel: label,
        dimensions: {
          lexical: 0.15 + index * 0.003,
          ast: 0.2,
          type: 0.2,
          control_flow: 0.18,
          data_flow: classIndex === 0 ? 0.75 : 0.22,
          dependency: 0.1,
          runtime: classIndex === 1 ? 0.72 : 0.2,
          benchmark: 0.08,
          security: 0.08,
          stability: 0.08,
          language: 0.2,
          environment: 0.1,
          hardware: 0.04,
          repair: 0.08,
          [signals[classIndex]]: 0.94 - index * 0.004,
        },
        magnitude: 1,
        confidence: 92,
        evidence: "deterministic supervised fixture",
      });
      assignments.push({
        vectorId: id,
        vectorName: id,
        predictedLabel: label,
        teacherLabel: label,
        trustScore: 94,
        consensusScore: 92,
        corrected: false,
        evidence: "trusted fixture teacher",
      });
    }
  });

  const report = trainDeepWebHead(vectors, {
    assignments,
    trustScore: 92,
    consensusRate: 90,
  });

  assert.notEqual(report.status, "warming");
  assert.ok(report.epochCount > 0);
  assert.ok(report.trainLossAfter < report.trainLossBefore);
  assert.ok(report.validationLossAfter <= report.validationLossBefore);
  assert.equal(report.classCount, 3);
  assert.equal(report.parameters.inputHiddenWeights.length, 14);
  assert.equal(report.parameters.hiddenOutputWeights.length, 12);

  const scores = scoreDeepWebHead(report.parameters, vectors[0].dimensions);
  const probabilitySum = Object.values(scores).reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(probabilitySum - 1) < 0.001);
  assert.equal(Object.keys(scores).length, 6);
});

test("DeepWeb head inherits only compatible stable parameters", () => {
  const emptySupervision = { assignments: [], trustScore: 0, consensusRate: 0 };
  const seed = trainDeepWebHead([], emptySupervision);
  const inherited = trainDeepWebHead([], emptySupervision, {
    id: "stable-model-v1",
    status: "stable",
    featureSchemaVersion: "deepweb-14d-v1",
    weights: {},
    networkParameters: seed.parameters,
    selectedGenomeId: "genome-v1",
    trustScore: 90,
    consensusRate: 90,
    fitnessScore: 90,
    regressionRiskScore: 2,
    checksum: "fixture",
    createdAt: 1,
  });

  assert.equal(inherited.inherited, true);
  assert.deepEqual(inherited.parameters, seed.parameters);
});
