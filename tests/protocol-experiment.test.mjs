import assert from "node:assert/strict";
import test from "node:test";

import { detectProtocolTargets, prepareProtocolExperiment } from "../src/lib/security/protocol-experiment.ts";
import { buildLocalSecurityAttackCorpus } from "../src/lib/security/security-assertions.ts";

function file(name, language, content) { return { id: name, name, language, content, imports: [], environmentRefs: [], deviceRefs: [] }; }

test("FastAPI protocol plan discovers a real route and creates an in-process TestClient harness", () => {
  const files = [file("backend/app/main.py", "Python", "from fastapi import FastAPI\napp = FastAPI()\n@app.post('/tasks')\ndef create_task(): pass\n")];
  const sample = buildLocalSecurityAttackCorpus().find((item) => item.kind === "sql-injection");
  const plan = prepareProtocolExperiment(files, sample);
  assert.equal(plan?.framework, "fastapi");
  assert.equal(plan?.targetRoute, "/tasks");
  assert.match(plan?.files.at(-1).content ?? "", /TestClient/);
  assert.doesNotMatch(plan?.files.at(-1).content ?? "", /localhost|127\.0\.0\.1/);
});

test("Express protocol plan uses supertest and never starts a listening socket", () => {
  const files = [file("src/app.js", "JavaScript", "const express=require('express'); const app=express(); app.get('/private', handler); module.exports={app};")];
  const targets = detectProtocolTargets(files);
  const sample = buildLocalSecurityAttackCorpus().find((item) => item.kind === "unauthenticated");
  const plan = prepareProtocolExperiment(files, sample);
  assert.equal(targets[0]?.routes[0]?.path, "/private");
  assert.equal(plan?.framework, "express");
  assert.match(plan?.files.at(-1).content ?? "", /supertest/);
  assert.doesNotMatch(plan?.files.at(-1).content ?? "", /\.listen\s*\(/);
});

test("Django, Flask and Spring plans use framework-native in-process clients", () => {
  const sample = buildLocalSecurityAttackCorpus().find((item) => item.kind === "csrf");
  const django = prepareProtocolExperiment([
    file("manage.py", "Python", "os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'project.settings')"),
    file("project/settings.py", "Python", "INSTALLED_APPS=[]"),
    file("project/urls.py", "Python", "urlpatterns=[path('admin/', admin.site.urls)]"),
  ], sample);
  assert.equal(django?.framework, "django");
  assert.match(django?.files.at(-1).content ?? "", /django-test-client/);

  const flask = prepareProtocolExperiment([file("app.py", "Python", "from flask import Flask\napp=Flask(__name__)\n@app.route('/submit', methods=['POST'])\ndef submit(): pass")], sample);
  assert.equal(flask?.framework, "flask");
  assert.match(flask?.files.at(-1).content ?? "", /application\.test_client/);

  const spring = prepareProtocolExperiment([file("src/main/java/demo/Application.java", "Java", "package demo; @SpringBootApplication public class Application { public static void main(String[] a){SpringApplication.run(Application.class,a);} } @PostMapping('/submit')")], sample);
  assert.equal(spring?.framework, "spring");
  assert.match(spring?.files.at(-1).content ?? "", /MockMvc/);
  assert.doesNotMatch(spring?.files.at(-1).content ?? "", /server\.port|localhost|\.listen\s*\(/);
});
