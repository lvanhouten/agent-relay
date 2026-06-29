Switch — binary setting toggle (theme, auto-reconnect, read-only attach).

```jsx
<Switch label="Auto-reconnect" defaultChecked />
<Switch label="Read-only" checked={ro} onChange={e => setRo(e.target.checked)} />
```

Accent green when on. Pair with a short label; for icon-only theme toggles prefer IconButton.
