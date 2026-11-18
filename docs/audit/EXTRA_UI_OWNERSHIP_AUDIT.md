# Extra UI ownership sweep

This additional sweep started from Root `2739785` and finished before the fresh final whole-app UI reviewer. It is not the final audit or native/release qualification. Its author used isolated source/component callbacks under pinned Electron-as-Node, with no screen takeover, build, install or physical device interaction.

| Isolated leaf | Reproduced behavior and implemented closure |
| --- | --- |
| `560433a` | PDF history source failure was unobserved; source switching could finish after close/suspend and retain superseded attachment bindings. Source ownership now spans error presentation, close and navigation; loading input is fenced. |
| `ad40eb6` | Floating menu rows, traversal and global Escape consumed composition, legacy key229 or already-consumed keys. Preserve the initiating keyboard owner. |
| `f0dccf7` | PDF Find/page navigation and page-field Enter ignored composition/consumed-key ownership. |
| `31d118d` | Document preview Escape/Find/zoom/page keys ignored composition/consumed-key ownership. |
| `7478741` | Document selection missed final pointer coordinates and retained cancelled/source-replaced/deactivated gestures. Capture belongs to the exact pointer/element; cancellation restores the prior box. |
| `71110a8` | Tablet box Escape affected composition, consumed keys or another focused pane. Scope its listener to the drawing's actual document and focused host. |
| `fc24cce` | Toolbar main/caret Arrow keys opened menus during composition or after consumption. |
| `772228f` | Pen settings Escape closed during composition or after another owner consumed it. |
| `9adb4c6` | Foreign pointers resized/ended the divider gesture; release coordinates were lost and capture loss left it live. Exact pointer/element ownership, final coordinate, retirement and keyboard guards now apply. |

The author reports a final focused run of129 passing cases, including124 new cases and five existing menu cases; overlapping intermediate runs are not additional distinct bugs or checks. Root independently integrated the leaves serially and passed a144-case affected group, the separate actual attachment preview cases, toolbar cases and17 divider/PenSheet cases. These groups also overlap and must not be summed.

Read-only breadth additionally covered pen mapping, ink/precision ownership, paper/background transforms, overview lifecycle and tablet fit. No confirmed failed reproduction remains open from this extra sweep. Unproved source leads were passed to the fresh reviewer: forwarded composition metadata in PadHost, consumed-key ownership in PageOverview and backdrop timeout recovery. They are not recorded as bugs without reproduction.

Root owns final whole-app audit integration, coherent full preflight, frozen package/native/performance/recovery checks and delivery. Synthetic event checks do not establish physical Wacom behavior.
