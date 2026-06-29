IconButton — square icon-only control for toolbars, terminal headers, and dense rows. Always pass `label` for accessibility.

```jsx
<IconButton label="Settings"><GearIcon/></IconButton>
<IconButton label="Split pane" bordered><SplitIcon/></IconButton>
<IconButton label="Toggle theme" active onClick={toggle}><MoonIcon/></IconButton>
```

Use `bordered` over busy surfaces, `active` for toggled state. Sizes `sm`/`md`/`lg`. Icon should be ~16–18px (sm) / 18–20px (md).
