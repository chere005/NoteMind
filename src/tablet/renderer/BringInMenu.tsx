import { MenuButton } from "./MenuButton"

// Every incoming drawing is a docked graphics pane, with a preview and editable ink.
export function BringInMenu({ title, off, onBring, onPage }) {
  return <MenuButton icon="dockin" label="Insert" name="Insert Drawing" primary mainOff={off !== null}
    data={{ capture: "ink" }} caretData={{ tablet: "bring-menu" }} caretDataBar="bring-menu"
    title={off ?? title} caretTitle="Insert drawing options" onMain={() => onBring("writing")}
    items={[{ label: "Writing", dataBar: "bring-writing", disabled: off !== null, onClick: () => onBring("writing") },
      { label: "Whole Sheet as Picture", dataBar: "bring-page", disabled: off !== null, onClick: onPage }]} />
}
