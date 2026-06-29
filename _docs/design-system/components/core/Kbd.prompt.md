Kbd — keyboard shortcut hints, used in command palettes, tooltips and the terminal toolbar.

```jsx
<Kbd>⌘</Kbd>
<Kbd keys={['⌘','K']} />        {/* renders ⌘ + K */}
<Kbd keys={['Ctrl','Shift','D']} />
```

Single key via children, combos via `keys`. Mono, with a 2px bottom border for a physical key feel.
