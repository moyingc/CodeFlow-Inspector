import type {
  DeepWebNeuralDatabaseReport,
  DeepWebReplayMemoryReport,
} from "@/src/lib/analysis/types";
import type { DeepWebSqliteJournalRow, DeepWebSqliteJournalTable } from "@/src/lib/persistence/deepweb-sqlite-journal";
import { simpleHash } from "@/src/lib/workspace/files";

/**
 * Turns the in-memory DeepWeb training result into durable, queryable model
 * artifacts. IDs are scoped to the replay snapshot so earlier generations are
 * retained instead of being overwritten by the next project analysis.
 */
export function buildDeepWebModelJournalRows(
  replay: DeepWebReplayMemoryReport,
  model: DeepWebNeuralDatabaseReport,
  createdAt = Date.now(),
): DeepWebSqliteJournalRow[] {
  const snapshot = replay.currentSnapshot;
  const runId = snapshot.id;
  const irrigationId = scoped(runId, model.irrigation.cycleId);
  const acceptedWeights = Object.fromEntries(
    model.irrigation.weightDeltas.map((item) => [item.dimensionKey, item.acceptedWeight]),
  );
  const inheritedModelVersion = model.evolution.genes.find(
    (gene) => gene.geneKind === "dimension_weight" && gene.inheritedFrom.includes(":model-"),
  )?.inheritedFrom;
  const promotionGate = modelPromotionGate(replay, model);
  const modelVersionId = scoped(runId, `model-${simpleHash(JSON.stringify(acceptedWeights))}`);
  const rows: DeepWebSqliteJournalRow[] = [];

  rows.push(
    row("deepweb_model_versions", modelVersionId, snapshot.projectHash, {
      id: modelVersionId,
      run_id: runId,
      parent_version_id: inheritedModelVersion ?? null,
      feature_schema_version: "deepweb-14d-v1",
      model_mode: model.mode,
      status: promotionGate,
      weights: acceptedWeights,
      network_parameters: model.trainableHead.parameters,
      selected_genome_id: scoped(runId, model.evolution.selectedGenomeId),
      training_sample_count: model.trainingSampleCount,
      validation_evidence_count: model.validationEvidenceCount,
      trust_score: model.supervised.trustScore,
      consensus_rate: model.supervised.consensusRate,
      fitness_score: model.evolution.fitnessScore,
      regression_risk_score: replay.regressionRiskScore,
      checksum: simpleHash(
        JSON.stringify({
          acceptedWeights,
          networkParameters: model.trainableHead.parameters,
          fitness: model.evolution.fitnessScore,
          gate: promotionGate,
        }),
      ),
      evidence: model.completed,
      created_at: createdAt,
    }, createdAt),
  );

  rows.push(
    row("deepweb_trainable_head_runs", scoped(runId, "mlp-head"), snapshot.projectHash, {
      id: scoped(runId, "mlp-head"),
      run_id: runId,
      model_version_id: modelVersionId,
      status: model.trainableHead.status,
      architecture: model.trainableHead.architecture,
      training_sample_count: model.trainableHead.trainingSampleCount,
      validation_sample_count: model.trainableHead.validationSampleCount,
      class_count: model.trainableHead.classCount,
      epoch_count: model.trainableHead.epochCount,
      learning_rate: model.trainableHead.learningRate,
      train_loss_before: model.trainableHead.trainLossBefore,
      train_loss_after: model.trainableHead.trainLossAfter,
      validation_loss_before: model.trainableHead.validationLossBefore,
      validation_loss_after: model.trainableHead.validationLossAfter,
      improvement: model.trainableHead.improvement,
      inherited: model.trainableHead.inherited,
      parameters: model.trainableHead.parameters,
      evidence: model.trainableHead.evidence,
      created_at: createdAt,
    }, createdAt),
  );

  model.generatedVectors.forEach((vector) => {
    rows.push(
      row("deepweb_feature_vectors", scoped(runId, vector.id), snapshot.projectHash, {
        id: scoped(runId, vector.id),
        run_id: runId,
        model_version_id: modelVersionId,
        source_table: vector.sourceTable,
        source_id: vector.sourceId,
        source_name: vector.sourceName,
        pseudo_label: vector.pseudoLabel,
        dimensions: Object.keys(vector.dimensions),
        vector: vector.dimensions,
        magnitude: vector.magnitude,
        confidence: vector.confidence,
        evidence: vector.evidence,
        created_at: createdAt,
      }, createdAt),
    );
  });

  model.inferenceRuns.forEach((inference) => {
    const vector = model.generatedVectors.find((item) => item.id === inference.sourceVectorId);
    rows.push(
      row("deepweb_inference_runs", scoped(runId, inference.id), snapshot.projectHash, {
        id: scoped(runId, inference.id),
        run_id: runId,
        model_version_id: modelVersionId,
        source_vector_id: scoped(runId, inference.sourceVectorId),
        source_table: inference.sourceTable,
        source_id: inference.sourceId,
        vector_hash: simpleHash(JSON.stringify(vector?.dimensions ?? {})),
        dimensions: vector?.dimensions ?? {},
        output_scores: inference.outputScores,
        predicted_class: inference.predictedClass,
        confidence: inference.confidence,
        evidence: inference.evidence,
        created_at: createdAt,
      }, createdAt),
    );
  });

  model.validationEvidence.forEach((evidence) => {
    rows.push(
      row("deepweb_validation_evidence", scoped(runId, evidence.id), snapshot.projectHash, {
        id: scoped(runId, evidence.id),
        run_id: runId,
        scenario_id: evidence.scenarioId,
        dimension_key: evidence.dimensionKey,
        evidence_kind: evidence.evidenceKind,
        source_table: evidence.sourceTable,
        source_id: evidence.sourceId,
        source_name: evidence.sourceName,
        dimensions: evidence.dimensions,
        confidence: evidence.confidence,
        passed: evidence.passed,
        replay: evidence.replay,
        evidence: evidence.evidence,
        created_at: createdAt,
      }, createdAt),
    );
  });

  model.extremeTests.forEach((test) => {
    rows.push(
      row("deepweb_extreme_test_runs", scoped(runId, test.id), snapshot.projectHash, {
        id: scoped(runId, test.id),
        run_id: runId,
        category: test.category,
        target: test.target,
        load_factor: test.loadFactor,
        pass_threshold: test.passThreshold,
        score: test.score,
        status: test.status,
        evidence: test.evidence,
        recommendation: test.recommendation,
        created_at: createdAt,
      }, createdAt),
    );
  });

  rows.push(
    row("deepweb_irrigation_runs", irrigationId, snapshot.projectHash, {
      id: irrigationId,
      run_id: runId,
      model_version_id: modelVersionId,
      cycle_index: replay.snapshotCount + 1,
      status: model.irrigation.status,
      evidence_inflow_count: model.irrigation.evidenceInflowCount,
      accepted_evidence_count: model.irrigation.acceptedEvidenceCount,
      isolated_evidence_count: model.irrigation.isolatedEvidenceCount,
      data_quality_score: model.irrigation.dataQualityScore,
      teacher_alignment_score: model.irrigation.teacherAlignmentScore,
      replay_score: model.irrigation.replayScore,
      stability_score: model.irrigation.stabilityScore,
      supervision_gain: model.irrigation.supervisionGain,
      stable_snapshot: model.irrigation.stableSnapshot,
      evidence: model.irrigation.evidence,
      next: model.irrigation.next,
      created_at: createdAt,
    }, createdAt),
  );

  model.irrigation.batches.forEach((batch) => {
    rows.push(
      row("deepweb_irrigation_evidence", scoped(runId, batch.id), snapshot.projectHash, {
        id: scoped(runId, batch.id),
        irrigation_run_id: irrigationId,
        source_kind: batch.sourceKind,
        source_table: batch.sourceTable,
        source_id: batch.id,
        source_name: batch.sourceKind,
        target_dimensions: batch.targetDimensions,
        evidence_count: batch.evidenceCount,
        accepted_count: batch.acceptedCount,
        isolated_count: batch.isolatedCount,
        quality_score: batch.qualityScore,
        accepted: batch.status === "accepted",
        isolated: batch.status === "isolated",
        batch_status: batch.status,
        evidence: batch.evidence,
        created_at: createdAt,
      }, createdAt),
    );
  });

  model.irrigation.epochs.forEach((epoch) => {
    rows.push(
      row("deepweb_irrigation_epochs", scoped(runId, epoch.id), snapshot.projectHash, {
        id: scoped(runId, epoch.id),
        irrigation_run_id: irrigationId,
        stage: epoch.stage,
        status: epoch.status,
        score: epoch.score,
        evidence_count: epoch.evidenceCount,
        evidence: epoch.evidence,
        action: epoch.action,
        created_at: createdAt,
      }, createdAt),
    );
  });

  model.irrigation.weightDeltas.forEach((delta) => {
    const id = scoped(runId, `weight-${delta.dimensionKey}`);
    rows.push(
      row("deepweb_weight_update_events", id, snapshot.projectHash, {
        id,
        irrigation_run_id: irrigationId,
        model_version_id: modelVersionId,
        dimension_key: delta.dimensionKey,
        before_weight: delta.beforeWeight,
        candidate_weight: delta.candidateWeight,
        accepted_weight: delta.acceptedWeight,
        delta: delta.delta,
        gate: delta.gate,
        evidence: delta.evidence,
        created_at: createdAt,
      }, createdAt),
    );
  });

  model.supervised.expertLabels.forEach((label) => {
    rows.push(
      row("deepweb_supervision_labels", scoped(runId, label.id), snapshot.projectHash, {
        id: scoped(runId, label.id),
        run_id: runId,
        source_kind: label.sourceKind,
        source_id: label.sourceId,
        target_vector_id: label.targetVectorId ? scoped(runId, label.targetVectorId) : null,
        target_pattern: label.targetPattern,
        label: label.label,
        confidence: label.confidence,
        trust_score: label.trustScore,
        evidence: label.evidence,
        corrective_action: label.correctiveAction,
        created_at: createdAt,
      }, createdAt),
    );
  });

  model.supervised.assignments.forEach((assignment, index) => {
    const id = scoped(runId, `assignment-${index}-${assignment.vectorId}`);
    rows.push(
      row("deepweb_supervised_assignments", id, snapshot.projectHash, {
        id,
        run_id: runId,
        vector_id: scoped(runId, assignment.vectorId),
        vector_name: assignment.vectorName,
        predicted_label: assignment.predictedLabel,
        teacher_label: assignment.teacherLabel,
        trust_score: assignment.trustScore,
        consensus_score: assignment.consensusScore,
        corrected: assignment.corrected,
        evidence: assignment.evidence,
        created_at: createdAt,
      }, createdAt),
    );
  });

  model.supervised.teacherReliability.forEach((teacher) => {
    const id = scoped(runId, `teacher-${teacher.sourceKind}`);
    rows.push(
      row("deepweb_teacher_reliability", id, snapshot.projectHash, {
        id,
        run_id: runId,
        source_kind: teacher.sourceKind,
        label_count: teacher.labelCount,
        accepted_count: teacher.acceptedCount,
        quarantined_count: teacher.quarantinedCount,
        conflict_count: teacher.conflictCount,
        reliability_score: teacher.reliabilityScore,
        status: teacher.status,
        evidence: teacher.evidence,
        updated_at: createdAt,
      }, createdAt),
    );
  });

  model.supervised.quarantinedSamples.forEach((sample) => {
    rows.push(
      row("deepweb_quarantined_labels", scoped(runId, sample.id), snapshot.projectHash, {
        id: scoped(runId, sample.id),
        run_id: runId,
        vector_id: scoped(runId, sample.vectorId),
        vector_name: sample.vectorName,
        source_kind: sample.sourceKind,
        candidate_labels: sample.candidateLabels,
        reason: sample.reason,
        confidence: sample.confidence,
        evidence: sample.evidence,
        recommended_action: sample.recommendedAction,
        created_at: createdAt,
      }, createdAt),
    );
  });

  const centroids = [
    ...model.supervised.centroids.map((centroid) => ({ source: "supervised", centroid })),
    ...model.selfSupervised.centroids.map((centroid) => ({ source: "self_candidate", centroid })),
  ];
  centroids.forEach(({ source, centroid }) => {
    const id = scoped(runId, `centroid-${source}-${centroid.label}`);
    rows.push(
      row("deepweb_label_centroids", id, snapshot.projectHash, {
        id,
        run_id: runId,
        model_version_id: modelVersionId,
        source,
        label: centroid.label,
        sample_count: centroid.sampleCount,
        vector: centroid.vector,
        dominant_dimensions: centroid.dominantDimensions,
        confidence: centroid.confidence,
        promoted: source === "supervised" && promotionGate === "stable",
        updated_at: createdAt,
      }, createdAt),
    );
  });

  model.selfSupervised.contrastivePairs.forEach((pair) => {
    rows.push(
      row("deepweb_contrastive_pairs", scoped(runId, pair.id), snapshot.projectHash, {
        id: scoped(runId, pair.id),
        run_id: runId,
        anchor_vector_id: scoped(runId, pair.anchorVectorId),
        positive_vector_id: scoped(runId, pair.positiveVectorId),
        negative_vector_id: scoped(runId, pair.negativeVectorId),
        label: pair.label,
        margin: pair.margin,
        confidence: pair.confidence,
        evidence: pair.evidence,
        created_at: createdAt,
      }, createdAt),
    );
  });

  rows.push(
    row("deepweb_self_supervised_epochs", scoped(runId, "self-epoch-1"), snapshot.projectHash, {
      id: scoped(runId, "self-epoch-1"),
      run_id: runId,
      model_version_id: modelVersionId,
      epoch_index: 1,
      vector_count: model.selfSupervised.vectorCount,
      pseudo_label_count: model.selfSupervised.pseudoLabelCount,
      contrastive_pair_count: model.selfSupervised.contrastivePairCount,
      loss_before: model.selfSupervised.lossBefore,
      loss_after: model.selfSupervised.lossAfter,
      learning_rate: model.selfSupervised.learningRate,
      updated_weights: model.selfSupervised.updatedWeights,
      status: "candidate_only",
      evidence: model.selfSupervised.evidence,
      created_at: createdAt,
    }, createdAt),
    row("deepweb_supervised_epochs", scoped(runId, "supervised-epoch-1"), snapshot.projectHash, {
      id: scoped(runId, "supervised-epoch-1"),
      run_id: runId,
      model_version_id: modelVersionId,
      teacher_sample_count: model.supervised.teacherSampleCount,
      matched_teacher_count: model.supervised.matchedTeacherCount,
      corrected_prediction_count: model.supervised.correctedPredictionCount,
      false_positive_guard_count: model.supervised.falsePositiveGuardCount,
      loss_before: model.supervised.lossBefore,
      loss_after: model.supervised.lossAfter,
      improvement: model.supervised.improvement,
      trust_score: model.supervised.trustScore,
      consensus_rate: model.supervised.consensusRate,
      calibration_weights: model.supervised.calibrationWeights,
      status: promotionGate,
      evidence: model.supervised.evidence,
      created_at: createdAt,
    }, createdAt),
  );

  const rollback = model.supervised.rollbackSnapshot;
  rows.push(
    row("deepweb_rollback_snapshots", scoped(runId, rollback.id), snapshot.projectHash, {
      id: scoped(runId, rollback.id),
      run_id: runId,
      model_version_id: modelVersionId,
      protected_tables: rollback.protectedTables,
      trigger: rollback.trigger,
      rollback_policy: rollback.rollbackPolicy,
      evidence: rollback.evidence,
      created_at: createdAt,
    }, createdAt),
  );

  model.errorSignals.forEach((signal) => {
    rows.push(
      row("deepweb_error_signals", scoped(runId, signal.id), snapshot.projectHash, {
        id: scoped(runId, signal.id),
        run_id: runId,
        signal_kind: signal.signalKind,
        severity: signal.severity,
        source_id: signal.sourceId,
        source_name: signal.sourceName,
        affected_label: signal.affectedLabel ?? null,
        confidence: signal.confidence,
        confidence_impact: signal.confidenceImpact,
        knowledge_score_impact: signal.knowledgeScoreImpact,
        fitness_impact: signal.fitnessImpact,
        evidence: signal.evidence,
        containment_action: signal.containmentAction,
        created_at: createdAt,
      }, createdAt),
    );
  });

  model.evolution.genes.forEach((gene) => {
    rows.push(
      row("deepweb_gene_pool", scoped(runId, gene.id), snapshot.projectHash, {
        id: scoped(runId, gene.id),
        run_id: runId,
        gene_kind: gene.geneKind,
        name: gene.name,
        expression: gene.expression,
        inherited_from: gene.inheritedFrom,
        mutation_delta: gene.mutationDelta,
        evidence: gene.evidence,
        updated_at: createdAt,
      }, createdAt),
    );
  });

  model.evolution.genomes.forEach((genome) => {
    rows.push(
      row("deepweb_genome_generations", scoped(runId, genome.id), snapshot.projectHash, {
        id: scoped(runId, genome.id),
        run_id: runId,
        model_version_id: modelVersionId,
        generation: genome.generation,
        parent_id: genome.parentId ? scoped(runId, genome.parentId) : null,
        strategy: genome.strategy,
        fitness_score: genome.fitnessScore,
        accepted: genome.accepted,
        genes: genome.genes,
        evidence: genome.evidence,
        created_at: createdAt,
      }, createdAt),
    );
    model.evolution.genes.forEach((gene) => {
      const id = scoped(runId, `expression-${genome.id}-${gene.id}`);
      rows.push(
        row("deepweb_gene_expression", id, snapshot.projectHash, {
          id,
          run_id: runId,
          genome_id: scoped(runId, genome.id),
          gene_id: scoped(runId, gene.id),
          project_signal: snapshot.projectHash,
          expression_level: genome.genes[gene.name] ?? gene.expression,
          evidence: `${genome.strategy} · ${gene.evidence}`,
          created_at: createdAt,
        }, createdAt),
      );
    });
  });

  model.evolution.fitness.forEach((fitness) => {
    rows.push(
      row("deepweb_fitness_scores", scoped(runId, fitness.id), snapshot.projectHash, {
        id: scoped(runId, fitness.id),
        run_id: runId,
        genome_id: scoped(runId, fitness.genomeId),
        accuracy_proxy: fitness.accuracyProxy,
        stability_proxy: fitness.stabilityProxy,
        safety_proxy: fitness.safetyProxy,
        generalization_proxy: fitness.generalizationProxy,
        regression_penalty: fitness.regressionPenalty,
        fitness_score: fitness.fitnessScore,
        evidence: fitness.evidence,
        created_at: createdAt,
      }, createdAt),
    );
  });

  return rows;
}

function modelPromotionGate(
  replay: DeepWebReplayMemoryReport,
  model: DeepWebNeuralDatabaseReport,
): "stable" | "candidate" | "quarantined" | "rollback" {
  if (replay.comparison.status === "regressed" || model.evolution.status === "rollback") return "rollback";
  if (model.supervised.trustScore < 62 || model.supervised.consensusRate < 62 || model.irrigation.status === "blocked") {
    return "quarantined";
  }
  if (
    model.irrigation.status === "hydrated" &&
    model.optimization.status === "optimized" &&
    model.trainableHead.status === "validated_candidate" &&
    replay.regressionRiskScore <= 18 &&
    model.supervised.trustScore >= 82 &&
    model.supervised.consensusRate >= 78
  ) {
    return "stable";
  }
  return "candidate";
}

function row(
  tableName: DeepWebSqliteJournalTable,
  primaryKey: string,
  projectHash: string,
  payload: Record<string, unknown>,
  createdAt: number,
): DeepWebSqliteJournalRow {
  return {
    id: `journal-${tableName}-${primaryKey}`,
    tableName,
    primaryKey,
    projectHash,
    payload,
    sql: `INSERT OR REPLACE INTO ${tableName} (${Object.keys(payload).join(", ")}) VALUES (${Object.values(payload)
      .map(sqlValue)
      .join(", ")});`,
    status: "pending",
    createdAt,
  };
}

function scoped(runId: string, value: string) {
  return `${runId}:${value}`;
}

function sqlValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return `'${text.replace(/'/g, "''")}'`;
}
