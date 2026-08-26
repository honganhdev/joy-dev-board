import type { WeeklyReport as ApiWeeklyReport } from '../../api/src/board/report-types';
import type { WeeklyReport as BrowserWeeklyReport } from './types';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
        (<Value>() => Value extends Left ? 1 : 2)
      ? true
      : false
    : false;

type Assert<Condition extends true> = Condition;

/** Fails web type-checking whenever the hand-maintained wire mirror drifts. */
export type WeeklyReportTypesStayInSync = Assert<Equal<ApiWeeklyReport, BrowserWeeklyReport>>;
