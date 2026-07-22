import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pluginsDir = path.resolve(__dirname, '../plugins');

let plugins = [];

export async function loadPlugins() {
  console.log('[Plugins] Loading Jarvis-style plugins...');
  if (!fs.existsSync(pluginsDir)) {
    try {
      fs.mkdirSync(pluginsDir, { recursive: true });
    } catch (e) {
      console.error('[Plugins] Failed to create plugins directory:', e.message);
      return;
    }
  }

  const files = fs.readdirSync(pluginsDir).filter(f => f.endsWith('.js'));
  plugins = [];

  for (const file of files) {
    const filePath = path.join(pluginsDir, file);
    try {
      const pluginModule = await import(`file://${filePath}`);
      const plugin = pluginModule.default || pluginModule;
      if (plugin.name && plugin.trigger && typeof plugin.run === 'function') {
        plugins.push(plugin);
        console.log(`[Plugins] Loaded plugin: ${plugin.name}`);
      } else {
        console.warn(`[Plugins] Invalid plugin structure in ${file}`);
      }
    } catch (err) {
      console.error(`[Plugins] Error loading plugin ${file}:`, err.message);
    }
  }
  console.log(`[Plugins] Total plugins active: ${plugins.length}`);
}

export async function matchAndRun(input, ghost) {
  for (const plugin of plugins) {
    let triggered = false;
    if (typeof plugin.trigger === 'function') {
      try {
        triggered = plugin.trigger(input);
      } catch (e) {
        console.error(`[Plugins] Error evaluating trigger for ${plugin.name}:`, e.message);
      }
    } else if (plugin.trigger instanceof RegExp) {
      triggered = plugin.trigger.test(input);
    } else if (typeof plugin.trigger === 'string') {
      triggered = input.toLowerCase().includes(plugin.trigger.toLowerCase());
    }

    if (triggered) {
      console.log(`[Plugins] Triggered plugin: ${plugin.name} for input: "${input}"`);
      try {
        const result = await plugin.run(ghost, input);
        return { matched: true, result };
      } catch (err) {
        console.error(`[Plugins] Error running plugin ${plugin.name}:`, err.message);
        return { matched: true, error: err.message };
      }
    }
  }
  return { matched: false };
}
