import {renderPublicSummary} from './public-summary.js';
document.body.classList.add('public-summary-mode');
renderPublicSummary(document.getElementById('kb'));
document.getElementById('rf').onclick=()=>location.reload();
