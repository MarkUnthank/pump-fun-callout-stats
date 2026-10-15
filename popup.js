import { mountPanel } from './app.js';
import { extensionClient } from './extension-client.js';
mountPanel(document.querySelector('#app'), extensionClient);
