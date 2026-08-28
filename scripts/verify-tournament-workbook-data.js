const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readAllData } = require('../server/tournament-data');

const extractionPath = path.resolve(process.argv[2] || '.codex-artifacts/zfb-workbook-2.json');
const extracted = JSON.parse(fs.readFileSync(extractionPath, 'utf8'));
const datasets = readAllData();
const mobile = datasets.find(data => data.event.id === '2026-zhuifeng-cup-mobile-2026-07-25');
const pc = datasets.find(data => data.event.id === '2026-zhuifeng-cup-pc-2026-07-26');
const slots = [
  ...Array.from({ length: 8 }, (_, index) => `escape${index + 1}`),
  ...Array.from({ length: 2 }, (_, index) => `hunter${index + 1}`),
  ...Array.from({ length: 5 }, (_, index) => `substitute${index + 1}`),
];

function rowsByNumber(sheetName) {
  return new Map(extracted.sheets[sheetName].rows.map(row => [row.row, row.values]));
}

function playersBySlot(team) {
  return new Map([
    ...team.roster.escape,
    ...team.roster.hunter,
    ...team.roster.substitutes,
  ].map(player => [player.slot, player]));
}

function teamBlocks(sheetName, stride) {
  const rows = rowsByNumber(sheetName);
  const blocks = new Map();
  for (const [rowNumber, values] of rows) {
    if (values[1] !== '昵称' || !values[0]) continue;
    blocks.set(values[0], { rowNumber, rows, stride });
  }
  return blocks;
}

function verifyMobile() {
  const blocks = teamBlocks('手游横版id名单', 2);
  let checked = 0;
  for (const team of Object.values(mobile.teams)) {
    const block = blocks.get(team.aliases.roster);
    assert(block, `${team.id}: mobile workbook team not found`);
    const names = block.rows.get(block.rowNumber);
    const ids = block.rows.get(block.rowNumber + 1);
    const players = playersBySlot(team);
    slots.forEach((slot, index) => {
      const player = players.get(slot);
      const nickname = names[index + 2] == null ? null : String(names[index + 2]);
      const officialId = ids[index + 2] == null ? null : String(ids[index + 2]);
      assert.equal(player?.nickname || null, nickname, `${team.id}:${slot} nickname mismatch`);
      assert.equal(player?.officialId || null, officialId, `${team.id}:${slot} official ID mismatch`);
      checked += 1;
    });
  }
  return checked;
}

function verifyPc() {
  const blocks = teamBlocks('端游横版id名单', 4);
  let checked = 0;
  for (const team of Object.values(pc.teams)) {
    const block = blocks.get(team.aliases.roster);
    assert(block, `${team.id}: PC workbook team not found`);
    const registeredNames = block.rows.get(block.rowNumber);
    const registeredIds = block.rows.get(block.rowNumber + 1);
    const matchNames = block.rows.get(block.rowNumber + 2);
    const matchIds = block.rows.get(block.rowNumber + 3);
    const players = playersBySlot(team);
    slots.forEach((slot, index) => {
      const player = players.get(slot);
      const expected = {
        nickname: matchNames[index + 2] == null ? null : String(matchNames[index + 2]),
        officialId: matchIds[index + 2] == null ? null : String(matchIds[index + 2]),
        registeredNickname: registeredNames[index + 2] == null ? null : String(registeredNames[index + 2]),
        registeredOfficialId: registeredIds[index + 2] == null ? null : String(registeredIds[index + 2]),
      };
      for (const [field, value] of Object.entries(expected)) {
        assert.equal(player?.[field] || null, value, `${team.id}:${slot} ${field} mismatch`);
      }
      checked += 1;
    });
  }
  return checked;
}

console.log(JSON.stringify({
  workbook: extracted.workbook,
  mobileSlotsChecked: verifyMobile(),
  pcSlotsChecked: verifyPc(),
}, null, 2));
