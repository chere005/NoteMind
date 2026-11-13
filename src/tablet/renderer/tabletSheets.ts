import {screenAspect} from './tabletPage';
import {tabletAspect,currentTurns} from './orientation';
import {sheetAspectFor} from '../shared/orientation';
export const currentSheetAspect = () => sheetAspectFor(tabletAspect() ?? screenAspect(), currentTurns());

