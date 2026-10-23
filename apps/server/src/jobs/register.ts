/**
 * Registers all background jobs. Feature modules add their job here (one import each).
 */
import './mediaGc.js';
import './linkPreviewGc.js';
import '../modules/auth/sessionCleanup.js';
import './disappearingPurge.js';
import './calls.js';
import './voice.js';
import './threads.js';
import './events.js';
import './statusExpiry.js';
import './presenceExpiry.js';
