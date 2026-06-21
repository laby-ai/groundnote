import fs from 'node:fs';
import path from 'node:path';

const baseUrl = process.env.OPENMAIC_SIDECAR_URL || 'http://127.0.0.1:5025';
const timeoutMs = Number(process.env.OPENMAIC_CLASSROOM_TIMEOUT_MS || 600000);
const pollIntervalMs = Number(process.env.OPENMAIC_CLASSROOM_POLL_MS || 5000);
const outDir = path.resolve('output/openmaic');

const requestBody = {
  requirement:
    process.env.OPENMAIC_CLASSROOM_REQUIREMENT ||
    '用中文生成一个 3 分钟微型课堂，主题是：如何把个人资料整理成可检索的知识库。要求包含一个概念讲解、一个选择题测验、一个互动讨论提示。',
  enableWebSearch: false,
  enableImageGeneration: false,
  enableVideoGeneration: false,
  enableTTS: false,
  agentMode: 'default',
};

function evidenceName(status) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(outDir, `classroom-generation-${stamp}-${status}.json`);
}

function classroomEvidenceName(classroomId) {
  const safeId = String(classroomId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(outDir, `classroom-${safeId}.json`);
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const started = Date.now();
  const record = { baseUrl, request: requestBody, polls: [] };

  const createResponse = await fetch(`${baseUrl}/api/generate-classroom`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestBody),
  });
  const createJson = await readJsonResponse(createResponse);
  record.createStatus = createResponse.status;
  record.create = createJson;

  const jobId = createJson?.data?.jobId || createJson?.jobId;
  if (!jobId) {
    const file = evidenceName('failed-create');
    fs.writeFileSync(file, JSON.stringify(record, null, 2));
    throw new Error(`OpenMAIC classroom job was not created. Evidence: ${file}`);
  }

  let finalData = null;
  while (Date.now() - started < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, record.polls.length === 0 ? 1500 : pollIntervalMs));
    const pollResponse = await fetch(`${baseUrl}/api/generate-classroom/${jobId}`);
    const pollJson = await readJsonResponse(pollResponse);
    const data = pollJson?.data || pollJson;
    const compact = {
      statusCode: pollResponse.status,
      status: data.status,
      step: data.step,
      progress: data.progress,
      message: data.message,
      scenesGenerated: data.scenesGenerated,
      totalScenes: data.totalScenes,
      result: data.result,
      error: data.error,
      at: new Date().toISOString(),
    };
    record.polls.push(compact);
    console.log(JSON.stringify(compact));
    if (data.done || data.status === 'succeeded' || data.status === 'failed') {
      record.final = pollJson;
      finalData = data;
      break;
    }
  }

  if (!finalData) {
    finalData = { status: 'timeout', error: `Timed out after ${timeoutMs}ms` };
    record.final = finalData;
  }

  let classroomFile = null;
  let sceneCount = 0;
  let totalActions = 0;
  let sceneSummary = [];
  if (finalData.status === 'succeeded' && finalData.result?.classroomId) {
    const classroomResponse = await fetch(`${baseUrl}/api/classroom?id=${finalData.result.classroomId}`);
    const classroomJson = await readJsonResponse(classroomResponse);
    classroomFile = classroomEvidenceName(finalData.result.classroomId);
    fs.writeFileSync(classroomFile, JSON.stringify(classroomJson, null, 2));
    const classroom = classroomJson?.data?.classroom || classroomJson?.classroom || classroomJson?.data;
    const scenes = Array.isArray(classroom?.scenes) ? classroom.scenes : [];
    sceneCount = scenes.length;
    sceneSummary = scenes.map(scene => {
      const actions = Array.isArray(scene.actions) ? scene.actions : [];
      totalActions += actions.length;
      return {
        id: scene.id,
        title: scene.title,
        type: scene.type,
        contentType: scene.content?.type,
        actionCount: actions.length,
      };
    });
    record.classroom = {
      statusCode: classroomResponse.status,
      file: classroomFile,
      sceneCount,
      totalActions,
      sceneSummary,
    };
  }

  const ok =
    finalData.status === 'succeeded' &&
    finalData.result?.url &&
    finalData.result?.scenesCount > 0 &&
    sceneCount === finalData.result.scenesCount &&
    totalActions > 0;
  const file = evidenceName(ok ? 'succeeded' : 'failed');
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
  console.log(JSON.stringify({
    ok,
    jobId,
    status: finalData.status,
    result: finalData.result,
    sceneCount,
    totalActions,
    sceneSummary,
    evidence: file,
    classroomEvidence: classroomFile,
    error: finalData.error,
  }, null, 2));

  if (!ok) process.exit(1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
