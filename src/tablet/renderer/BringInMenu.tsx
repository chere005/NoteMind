import { MenuButton } from "./MenuButton"

export function BringInMenu({ title, off, onBring, onPage, docked, onDocked }) {
  return <MenuButton icon="dockin" label="Insert" name="Insert Drawing" primary mainOff={off !== null}
    data={{ capture: "ink" }} caretData={{ tablet: "bring-menu" }} caretDataBar="bring-menu"
    title={off ?? title} caretTitle="Insert drawing options" onMain={() => onBring("writing")}
    live items={[{ label: "Writing", dataBar: "bring-writing", disabled: off !== null, onClick: () => onBring("writing") },
      { label: "Whole Sheet as Picture", dataBar: "bring-page", disabled: off !== null, onClick: onPage },
      "-", { label: "Dock in Notepad", checked: docked, keepOpen: true, dataBar: "bring-docked", onClick: () => onDocked(!docked) }]} />
}
