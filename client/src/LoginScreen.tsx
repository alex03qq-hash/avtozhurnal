/** Экран входа: показывается, когда на компьютере задан код доступа. */

import React, { useState } from 'react';
import { getAccessToken } from './api.ts';
import { Button, Field, TextInput } from './ui.tsx';

export default function LoginScreen({ onSignIn }: { onSignIn: (token: string) => Promise<boolean> }) {
  const [token, setToken] = useState(getAccessToken());
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setFailed(false);
    const ok = await onSignIn(token.trim());
    setFailed(!ok);
    setBusy(false);
  };

  return (
    <div className="login">
      <form className="login__card" onSubmit={submit}>
        <span className="brand__mark login__mark">АЖ</span>
        <h1 className="login__title">АвтоЖурнал</h1>
        <p className="login__text">
          Журнал защищён кодом доступа. Введите код, который задан на компьютере в переменной
          <code>ACCESS_TOKEN</code> — он запомнится в этом браузере.
        </p>
        <Field label="Код доступа">
          <TextInput
            type="password"
            value={token}
            autoFocus
            autoComplete="current-password"
            onChange={(event) => setToken(event.target.value)}
            placeholder="например, 4821-журнал"
          />
        </Field>
        {failed && <p className="login__error" role="alert">Код не подошёл. Проверьте его на компьютере и попробуйте снова.</p>}
        <Button variant="primary" type="submit" disabled={busy || !token.trim()}>
          {busy ? 'Проверяем…' : 'Открыть журнал'}
        </Button>
        <p className="login__hint">
          Код отключается на компьютере: уберите переменную <code>ACCESS_TOKEN</code> и перезапустите приложение.
        </p>
      </form>
    </div>
  );
}
