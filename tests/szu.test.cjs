const assert = require('node:assert/strict');
const { buildSubmission, BANK } = require('../physics-lab-preexam-szu.user.js');

let count = 0;
for (const [id, group] of Object.entries(BANK)) {
  const paper = {
    preview_id: Number(id), remaining_attempts: 3,
    question_order: {}, option_orders: {},
    questions: group.questions.map(q => ({
      id: q.id, type: q.type, content: q.content,
      options: q.type === 'judge' ? [] : q.options.slice().reverse().map((text, index) => ({ id: String.fromCharCode(65 + index), text })),
    })).reverse(),
  };
  const result = buildSubmission(Number(id), paper);
  assert.equal(Object.keys(result.answers).length, group.questions.length);
  for (const q of paper.questions) {
    const source = group.questions.find(item => item.id === q.id);
    const actual = result.answers[q.id];
    assert.deepEqual(q.type === 'judge' ? actual : actual.map(letter => q.options.find(option => option.id === letter).text).sort(),
      q.type === 'judge' ? [source.answer[0] === '正确' ? 'T' : 'F'] : source.answer.slice().sort());
    count++;
  }
  assert.throws(() => buildSubmission(Number(id), { ...paper, remaining_attempts: 2 }), /提交机会/);
  assert.throws(() => buildSubmission(Number(id), { ...paper, questions: paper.questions.slice(1) }), /题目数/);
  const altered = structuredClone(paper);
  altered.questions[0].content += '变更';
  assert.throws(() => buildSubmission(Number(id), altered), /不符/);
  const optionQuestion = paper.questions.find(q => q.type !== 'judge');
  if (optionQuestion) {
    const changed = structuredClone(paper);
    changed.questions.find(q => q.id === optionQuestion.id).options[0].text += '变更';
    assert.throws(() => buildSubmission(Number(id), changed), /选项有变化/);
  }
}
assert.equal(count, 218);
console.log(`Verified ${count} reviewed answers across 12 experiments with reordered questions/options and stop conditions.`);
