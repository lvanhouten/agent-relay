Input — single-line text field for credentials, host names, session labels. Labels are uppercase mono eyebrows.

```jsx
<Input label="Relay host" placeholder="main.local:7070" mono prefix={<ServerIcon/>} />
<Input label="Access token" type="password" error="Token rejected" />
<Input label="Session name" hint="Shown in the session list" />
```

Use `mono` for technical values (hosts, ports, paths, tokens). `error` overrides `hint`. Sizes `sm`/`md`/`lg`.
