StatusDot — the brand's signature signal indicator. Shows live connection state for a session or the relay host. The `online` state pulses by default (the green "relay" glow).

```jsx
<StatusDot status="online" />              {/* pulsing green · "online" */}
<StatusDot status="idle" />                {/* amber · "idle" */}
<StatusDot status="offline" showLabel={false} />
<StatusDot status="error" label="lost link" />
```

States: `online` (green, pulsing), `idle` (amber), `offline` (gray), `error` (red). Set `showLabel={false}` for a bare dot in dense rows. Disable motion with `pulse={false}`.
