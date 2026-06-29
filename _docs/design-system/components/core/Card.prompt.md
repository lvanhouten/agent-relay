Card — surface container for session tiles, settings panels and grouped content.

```jsx
<Card>Static panel content</Card>
<Card interactive onClick={attach}>Clickable session tile (hover lift + accent border)</Card>
<Card selected>Currently selected session</Card>
<Card flat padding="lg">Borderless-shadow block</Card>
```

Use `interactive` for clickable tiles, `selected` for the active item (accent glow). `padding` `sm`/`md`/`lg`; `flat` drops the shadow for nested/grouped use.
