# Working on this project

## Spelling: British English in prose, American in identifiers

Every word this project writes — comments, docstrings, panel text, commit
messages, README — uses **British spelling**: `colour`, `centre`, `catalogue`,
`neighbour`, `ionised`, `grey`, `licence` (noun) and `licensed` (verb).

**Identifiers keep whatever their ecosystem uses.** `colorLut`, `colorSpace`,
`THREE.Color` and `VII/20/catalog` stay exactly as they are: three.js and VizieR
named those, not us, and renaming a library's API to suit a style guide is how
code stops compiling. A comment about colour sitting above a `colorLut` is
correct, not an oversight.

**`LICENSE` is a filename, not a word.** GitHub, npm and PyPI look for that
spelling and no other. The prose beside it still says *licence*.

### Why British, since it was asked

Not because it is the house style — for a long time the only evidence for that
was that I had written it that way myself, which is not evidence. The reason
that survives checking is the Encyclopaedia Galactica's own prose, 1,629 lines
of which this map quotes on screen in the history panel. Measured over that
corpus it leans British about 2:1, most sharply on the word this project uses
more than any other: **`colonised` 103, `colonized` 12**, and `grey` 22 to 1.

Orion's Arm itself has no convention to match. Its submission guidelines
deliberately decline to pick one —

> Please specify if you use British, Australian, American, or other varieties of
> English, to help avoid spelling errors.
> — <https://www.orionsarm.com/page/552>

— so their corpus is mixed by policy rather than by accident, and what the guide
actually asks of a contributor is to **declare a variety and hold to it**. This
file is that declaration. The point is that our captions sit on the same screen
as their sentences, and the seam should not show.

## A note on authorship

Every commit in this repository carries a Claude co-author trailer. Orion's Arm
does not accept AI-written submissions to its own site — that policy is on the
same page linked above — so nothing here should be offered to them as a
submission without saying plainly how it was made. Citing them, which is what
this map does, is a different thing from contributing to them.
