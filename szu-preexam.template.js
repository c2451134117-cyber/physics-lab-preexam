// ==UserScript==
// @name         深圳大学物理实验预习（阅卷题库）
// @namespace    https://github.com/c2451134117-cyber/physics-lab-preexam
// @version      1.0.0
// @description  使用满分阅卷题库匹配新平台试卷，核验全部题目后每实验自动提交一次。
// @match        http://172.25.75.220/student/answer/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';
  const BANK = __BANK_JSON__;
  const normalize = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  const sameSet = (left, right) => left.length === right.length &&
    JSON.stringify(left.map(normalize).sort()) === JSON.stringify(right.map(normalize).sort());

  function buildSubmission(previewId, paper) {
    const group = BANK[String(previewId)];
    if (!group) throw new Error('此实验尚无阅卷题库。');
    if (Number(paper.preview_id) !== Number(previewId)) throw new Error('试卷 ID 不匹配。');
    if (Number(paper.remaining_attempts) !== 3) throw new Error('该实验已用过提交机会，停止自动提交。');
    if (!Array.isArray(paper.questions) || paper.questions.length !== group.questions.length) throw new Error('题目数与题库不同。');
    const expected = new Map(group.questions.map(q => [Number(q.id), q]));
    if (expected.size !== group.questions.length) throw new Error('题库存在重复题目 ID。');
    const answers = {};
    for (const question of paper.questions) {
      const source = expected.get(Number(question.id));
      if (!source || source.type !== question.type || normalize(source.content) !== normalize(question.content)) {
        throw new Error(`题目 ${question.id} 与题库不符，停止提交。`);
      }
      if (question.type === 'judge') {
        if (source.answer.length !== 1 || !['正确', '错误'].includes(source.answer[0])) throw new Error(`判断题 ${question.id} 答案无效。`);
        answers[String(question.id)] = [source.answer[0] === '正确' ? 'T' : 'F'];
      } else {
        const options = question.options || [];
        if (!sameSet(source.options, options.map(option => option.text))) throw new Error(`题目 ${question.id} 选项有变化。`);
        if (!source.answer.length || (question.type !== 'multiple' && source.answer.length !== 1)) throw new Error(`题目 ${question.id} 答案数量无效。`);
        const selected = [];
        for (const answer of source.answer) {
          const matches = options.filter(option => normalize(option.text) === normalize(answer));
          if (matches.length !== 1) throw new Error(`题目 ${question.id} 答案无法唯一匹配。`);
          selected.push(matches[0].id);
        }
        if (new Set(selected).size !== selected.length) throw new Error(`题目 ${question.id} 答案重复。`);
        answers[String(question.id)] = selected.sort();
      }
      expected.delete(Number(question.id));
    }
    if (expected.size) throw new Error('试卷缺少题库中的题目。');
    return { question_order: paper.question_order, option_orders: paper.option_orders, answers };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { buildSubmission, normalize, sameSet, BANK };
    return;
  }

  const match = location.pathname.match(/^\/student\/answer\/(\d+)\/?$/);
  if (!match) return;
  const previewId = Number(match[1]);
  const message = document.createElement('div');
  message.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:99999;background:#fff;color:#222;padding:10px 14px;border:1px solid #bbb;border-radius:6px;box-shadow:0 2px 8px #0002;font:13px sans-serif;max-width:360px';
  message.textContent = '正在核对阅卷题库…';
  document.body.append(message);
  const report = text => { message.textContent = text; };
  let started = false;

  function userIdFromToken(token) {
    const payload = token.split('.')[1];
    if (!payload) throw new Error('无法识别当前账号令牌。');
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
    const id = claims.user_id ?? claims.sub;
    if (id === undefined || id === null || id === '') throw new Error('无法确认当前账号。');
    return String(id);
  }

  async function request(path, token, options = {}) {
    const response = await fetch(`/api${path}`, {
      ...options,
      credentials: 'same-origin',
      headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    });
    if (!response.ok) throw new Error(`网站请求失败（HTTP ${response.status}）；没有自动重试。`);
    return response.json();
  }

  async function reserve(key) {
    const db = await new Promise((resolve, reject) => {
      const open = indexedDB.open('physics-preexam-szu-once-v1', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('attempts', { keyPath: 'key' });
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(new Error('无法保存防重复记录。'));
    });
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction('attempts', 'readwrite');
        transaction.objectStore('attempts').add({ key, time: new Date().toISOString() });
        transaction.oncomplete = resolve;
        transaction.onerror = transaction.onabort = () => reject(new Error('本浏览器已尝试提交此实验；请查看预习记录。'));
      });
    } finally { db.close(); }
  }

  async function run() {
    if (started) return;
    started = true;
    try {
      const token = sessionStorage.getItem('access_token');
      if (!token) throw new Error('请先正常登录网站。');
      const userId = userIdFromToken(token);
      const listed = await request('/previews/?page_size=100', token);
      const previews = Array.isArray(listed) ? listed : listed.results;
      const preview = previews?.find(item => Number(item.id) === previewId);
      if (!preview || preview.status !== 'ongoing') throw new Error('此实验未开放，停止提交。');
      if (preview.done) throw new Error('此实验已有提交记录，停止自动提交。');
      const paper = await request(`/previews/${previewId}/questions/`, token);
      const submission = buildSubmission(previewId, paper);
      // Reserve before POST. If the outcome is uncertain, a reload must not submit again.
      await reserve(`${location.origin}:${userId}:${previewId}`);
      if (location.pathname !== `/student/answer/${previewId}` || sessionStorage.getItem('access_token') !== token) {
        throw new Error('页面或账号发生变化；提交已锁定，请查看记录。');
      }
      report(`已核对 ${Object.keys(submission.answers).length} 题，正在提交一次…`);
      const result = await request(`/previews/${previewId}/submit/`, token, { method: 'POST', body: JSON.stringify(submission) });
      report(`提交成功：${result.score} / ${result.total_score}；剩余 ${result.remaining_attempts} 次。`);
    } catch (error) { report(error.message); }
  }
  run();
})();
