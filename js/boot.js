// Inicialização: confere o token de acesso deste aparelho antes de carregar o editor.
import { currentAccess, accessScreen } from './access.js';

(async () => {
  let a = await currentAccess();
  if (!a.ok) a = { ...(await accessScreen(a.code, a.reason && a.reason !== 'token incompleto' ? a.reason : '')), code: a.code };
  window.__mfAccess = a;
  await import('./main.js');
})();
