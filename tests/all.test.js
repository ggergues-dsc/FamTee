// Test entry point: import every test module, then run.

import { run } from './harness.js';
import './ids.test.js';
import './model.test.js';
import './validate.test.js';
import './migrate.test.js';
import './serialize.test.js';
import './store.test.js';
import './layout.test.js';
import './render.test.js';

run();
