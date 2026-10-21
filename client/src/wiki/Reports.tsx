import React, { useEffect, useState } from "react";
import { Check, Flag, RotateCcw } from "lucide-react";
import { Report, ReportKind, Space } from "@commons-root/gen-shared";
import { loadNames } from "../users";
import { errorText, spaceName, wiki } from "./api";
import { NavLink, pageRoute } from "./nav";
import { withUser } from "../ui/UserName";
import { locale, t } from "../i18n";

type Props = { spaces: Space[]; pageId?: string; onChanged: () => void };

/** What readers reported in the spaces the editor writes in: errors and suggested additions. */
const Reports: React.FC<Props> = ({ spaces, pageId = "", onChanged }) => {
  const [resolved, setResolved] = useState(false);
  const [reports, setReports] = useState<Report[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setNames] = useState(0);
  const load = () =>
    wiki
      .listReports({ spaceId: "", pageId, resolved })
      .then(async (r) => {
        setReports(r.reports);
        await loadNames([...new Set(r.reports.flatMap((x) => [x.authorId, x.resolvedBy].filter(Boolean)))]);
        setNames((n) => n + 1);
      })
      .catch((err) => setError(errorText(err)));
  useEffect(() => {
    load();
  }, [resolved, pageId]);

  const resolve = (r: Report, done: boolean) =>
    wiki
      .resolveReport({ id: r.id, resolved: done })
      .then(() => {
        load();
        onChanged();
      })
      .catch((err) => setError(errorText(err)));

  return (
    <div className="reports-view">
      <h1 className="page-title">
        <Flag size={24} /> {t("reports.title")}
      </h1>
      {pageId && (
        <p className="hint">
          {t("reports.onePage")} <NavLink to={{ view: "reports" }}>{t("reports.showAll")}</NavLink>
        </p>
      )}
      <div className="segmented">
        <button className={resolved ? "" : "on"} onClick={() => setResolved(false)}>
          {t("reports.open")}
        </button>
        <button className={resolved ? "on" : ""} onClick={() => setResolved(true)}>
          {t("reports.resolved")}
        </button>
      </div>
      {error && <div className="banner error">{error}</div>}
      {reports && !reports.length && <p className="hint list-empty">{resolved ? t("reports.noneResolved") : t("reports.none")}</p>}
      <ul className="report-list">
        {(reports ?? []).map((r) => (
          <li key={r.id} className="report">
            <div className="report-head">
              <span className={r.kind === ReportKind.REPORT_ADDITION ? "report-kind addition" : "report-kind error"}>
                {r.kind === ReportKind.REPORT_ADDITION ? t("report.addition") : t("report.error")}
              </span>
              <NavLink to={pageRoute(r.spaceId, r.pageId)}>{r.pageTitle}</NavLink>
              {spaces.length > 1 && <span className="hint">{spaceName(spaces, r.spaceId)}</span>}
            </div>
            <p className="report-text">{r.text}</p>
            <div className="report-foot">
              <span className="hint">
                {withUser(
                  t("reports.by", {
                    name: "\u0001",
                    date: new Date(Number(r.createdAt)).toLocaleDateString(locale(), { dateStyle: "medium" }),
                  }),
                  r.authorId,
                )}
                {r.resolvedAt > 0n && <> · {withUser(t("reports.resolvedBy", { name: "\u0001" }), r.resolvedBy)}</>}
              </span>
              {resolved ? (
                <button onClick={() => resolve(r, false)}>
                  <RotateCcw size={14} /> {t("reports.reopen")}
                </button>
              ) : (
                <button onClick={() => resolve(r, true)}>
                  <Check size={14} /> {t("reports.markResolved")}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default Reports;
