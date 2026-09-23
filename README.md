# @c9up/lumen

Terminal output for the Ream ecosystem: colours, a logger with a fixed
vocabulary, tables, boxes, steps and task reports — and a raw mode that makes
all of it assertable.

No dependencies. Node built-ins only.

```ts
import { lumen } from '@c9up/lumen'

const ui = lumen()

ui.logger.success('3 migrations applied', { startTime })
ui.logger.warning('config/mail.ts is missing a sender')

const create = ui.logger.action('creating config/auth.ts')
try {
  await write()
  create.displayDuration().succeeded()
} catch (error) {
  create.failed(error)
}

ui.table().head(['Name', 'Batch']).row(['create_users_table', '1']).render()
```

## Modes

A UI is in one of three modes, decided once:

| mode | colours | output |
|---|---|---|
| `normal` | escape codes | the terminal |
| `silent` | none | the terminal |
| `raw` | spelled out — `dim(yellow(2 files))` | memory |

`lumen()` picks between `normal` and `silent` by asking the stream, so nothing
downstream has to check again. `NO_COLOR`, `FORCE_COLOR`, `TERM=dumb` and CI
detection are all handled there.

`raw` is for tests. An expected line stays a string a human can read:

```ts
const ui = lumen({ mode: 'raw' })
ui.logger.warning('careful')
expect(ui.getLogs()).toEqual(['[ yellow(warn) ] careful'])
```

## Levels

The vocabulary is fixed on purpose — the same word, in the same colour, for the
same meaning, in every package:

```
[ success ] green   [ error ] red     [ warn ] yellow
[ info ] blue       [ debug ] cyan    [ wait ] cyan
```

`warning`, `error` and `fatal` go to **stderr**, so a command's data output
stays pipeable.

Each message takes a `prefix` (dim, `%time%` interpolated), a `suffix` (dim
yellow, in parentheses) and a `startTime` (a `Date.now()`, rendered as the
elapsed time).

## Colours on their own

`@c9up/lumen/colors` carries no widget:

```ts
import { ansiColors } from '@c9up/lumen/colors'

const colors = ansiColors()
colors.dim.yellow('2 files')     // property chain
colors.dim().yellow('2 files')   // call chain — same thing
```

Each style closes with its own code rather than a blanket reset, so a nested
call restores what the outer one was holding: `red('a ' + dim('b') + ' c')`
stays red after the `b`.

## Layout

`@c9up/lumen/helpers` has the primitives the widgets are built on —
`stringWidth`, `justify`, `wrap`, `truncate`, `terminalWidth`. `stringWidth`
ignores escape codes, gives a combining accent no width and counts a CJK glyph
or an emoji as two columns; measuring with `String.length` is how a table with
one emoji in it becomes ragged for every row below.

## License

MIT
