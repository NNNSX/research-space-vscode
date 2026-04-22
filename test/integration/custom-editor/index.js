const aiSettings = require('./ai-settings.test.js');
const ollamaProvider = require('./ollama-provider.test.js');
const ollamaSmoke = require('./ollama-smoke.test.js');
const smoke = require('./smoke.test.js');
const saveReload = require('./save-reload.test.js');
const undoRedo = require('./undo-redo.test.js');
const externalMigrationReload = require('./external-migration-reload.test.js');
const blueprintOutputReload = require('./blueprint-output-reload.test.js');
const blueprintOutputHistoryReload = require('./blueprint-output-history-reload.test.js');
const blueprintLegacyOutputHistoryMigration = require('./blueprint-legacy-output-history-migration.test.js');
const blueprintDefinitionHistoryRebind = require('./blueprint-definition-history-rebind.test.js');
const blueprintDefinitionManualHistoryPosition = require('./blueprint-definition-manual-history-position.test.js');
const blueprintDefinitionMixedHistoryReload = require('./blueprint-definition-mixed-history-reload.test.js');
const blueprintDefinitionExternalOverwriteReload = require('./blueprint-definition-external-overwrite-reload.test.js');
const blueprintDefinitionMultiHistoryReload = require('./blueprint-definition-multi-history-reload.test.js');
const blueprintDefinitionResumeHistoryReload = require('./blueprint-definition-resume-history-reload.test.js');
const blueprintDefinitionResumeRefailReload = require('./blueprint-definition-resume-refail-reload.test.js');
const blueprintRunHistoryReload = require('./blueprint-run-history-reload.test.js');
const blueprintRunHistoryMessageFlow = require('./blueprint-run-history-message-flow.test.js');

async function run() {
  await aiSettings.run();
  await ollamaProvider.run();
  await ollamaSmoke.run();
  await smoke.run();
  await saveReload.run();
  await undoRedo.run();
  await externalMigrationReload.run();
  await blueprintOutputReload.run();
  await blueprintOutputHistoryReload.run();
  await blueprintLegacyOutputHistoryMigration.run();
  await blueprintDefinitionHistoryRebind.run();
  await blueprintDefinitionManualHistoryPosition.run();
  await blueprintDefinitionMixedHistoryReload.run();
  await blueprintDefinitionExternalOverwriteReload.run();
  await blueprintDefinitionMultiHistoryReload.run();
  await blueprintDefinitionResumeHistoryReload.run();
  await blueprintDefinitionResumeRefailReload.run();
  await blueprintRunHistoryReload.run();
  await blueprintRunHistoryMessageFlow.run();
}

module.exports = { run };
