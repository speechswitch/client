> ## Documentation Index
> Fetch the complete documentation index at: https://docs.rime.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Spell function

> Force letter-by-letter pronunciation of codes, IDs, and acronyms using the spell() function for naturalistic pauses within the sequence.

## When to use `spell()`

Use `spell()` when you need a letter or number sequence spelled out, one unit at a time.

`spell()` is a Mist-family feature; Coda's pipeline does not process it. On Mist v3 it inserts naturalistic pauses within a sequence, grouping numbers and letters in threes where possible and pairs where necessary. The English grammar normalizer used by `/textnorm` instead spells letters straight through and groups digits in pairs. For example, it breaks a standard 10-digit telephone number into:

> 4 2 5 `<pause>` 2 5 2 `<pause>` 8 9 `<pause>` 2 9

The same grouping applies to long words:

> P E N `<pause>` E L O `<pause>` P E

`spell()` also inserts pauses when a mixed sequence transitions between letters and numbers:

> P R M `<pause>` 4 2 3 `<pause>` G D D `<pause>` M L `<pause>` 2 `<pause>` 3 5 4

Any number, letter, or alphanumeric string inside `spell()` is read in full. The function also reads common symbols such as @ (at) and - (dash).

Use the request examples below to test each type of sequence.

## `spell()` applied to words

If I want the sentence to read:

> "The name is spelled J O N, A T H, A N."

**Input:**
`the name is spelled spell(jonathan).`

<audio controls src="/sounds/docs/jonathan.mp3" />

<Tabs>
  <Tab title="Mist v3">
    ```json theme={null}
    {
       "speaker": "astra",
       "modelId": "mistv3",
       "text": "the name is spelled spell(jonathan)."
    }
    ```
  </Tab>
</Tabs>

## `spell()` applied to numbers

For number sequences, if I want the sentence to read:

> "The number is 4 2 5, 2 5 2, 8 9, 2 9."

**Input:**
` the number is spell(4252528929).`

<Tabs>
  <Tab title="Mist v3">
    ```json theme={null}
    {
       "speaker": "astra",
       "modelId": "mistv3",
       "text": "the number is spell(4252528929)."
    }
    ```
  </Tab>
</Tabs>

## `spell()` applied to alphanumeric sequences

The same goes for mixed alphanumerics. If I want the sentence to be read:

> the account is r f, 5, 4 3, d, c, 2

**Input:**
`the account is spell(rf543dc2).`

<Tabs>
  <Tab title="Mist v3">
    ```json theme={null}
    {
       "speaker": "astra",
       "modelId": "mistv3",
       "text": "the account is spell(rf543dc2)."
    }
    ```
  </Tab>
</Tabs>

## `spell()` applied to typographical symbols

| Symbol | Pronunciation |
| ------ | ------------- |
| `@`    | at            |
| `_`    | underscore    |
| `-`    | dash          |
| `.`    | dot           |

Spell also works with common symbols. For example:

> the email address is h e, l p, at, r i, m e, dot, a i

**Input:**
`the email address is spell(help@rime.ai).`

<Tabs>
  <Tab title="Mist v3">
    ```json theme={null}
    {
       "speaker": "astra",
       "modelId": "mistv3",
       "text": "the email address is spell(help@rime.ai)."
    }
    ```
  </Tab>
</Tabs>
