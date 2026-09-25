/**
 * Registers all background jobs. Feature modules add their job here (one import each).
 */
import './mediaGc.js';
import '../modules/auth/sessionCleanup.js';
import './disappearingPurge.js';
import './calls.js';
import './statusExpiry.js';
