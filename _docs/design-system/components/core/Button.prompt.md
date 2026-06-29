Button — the primary action control; use for any committed action (connect, create session, save).

```jsx
<Button variant="primary" onClick={connect}>Connect session</Button>
<Button variant="secondary" size="sm" leadingIcon={<PlusIcon/>}>New session</Button>
<Button variant="ghost" size="sm">Cancel</Button>
<Button variant="danger" loading>Terminating…</Button>
```

Variants: `primary` (signal-green, one per view), `secondary` (bordered surface), `ghost` (text-only, toolbar use), `danger` (destructive). Sizes: `sm` (28px), `md` (36px, default), `lg` (44px). Use `loading` for async actions and `leadingIcon`/`trailingIcon` for affordances. Pair primary sparingly — one dominant action per screen.
