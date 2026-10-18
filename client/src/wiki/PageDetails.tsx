import React, { useEffect, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { AccessLevel, Category, FieldDef, FieldKind, FieldValue, Page, PageType } from "@commons-root/gen-shared";
import { categoryOptions, errorText, LANGS, langName, typeOf, valueOf, wiki } from "./api";
import { imageUrl, uploadImage } from "./Infobox";
import { t } from "../i18n";

type Props = {
  page: Page;
  types: PageType[];
  categories: Category[];
  onError: (message: string) => void;
  onSaved: () => void;
};

type Draft = { title: string; typeId: string; categoryId: string; tags: string; lang: string; fields: FieldValue[] };

const draftOf = (page: Page): Draft => ({
  title: page.title,
  typeId: page.typeId,
  categoryId: page.categoryId,
  tags: page.tags.join(", "),
  lang: page.lang,
  fields: page.fields,
});

/**
 * What the page is, above its text: title, type, category, tags, language
 * and the type's fields (shown in the infobox). Saved as soon as a value is
 * left; published with the text.
 */
const PageDetails: React.FC<Props> = ({ page, types, categories, onError, onSaved }) => {
  const [draft, setDraft] = useState<Draft>(() => draftOf(page));
  // Another editor's change shows here, unless this one is being typed.
  useEffect(() => setDraft(draftOf(page)), [page.title, page.typeId, page.categoryId, page.tags.join(","), page.lang, JSON.stringify(page.fields)]);
  const canEdit = page.level >= AccessLevel.EDIT;
  const type = typeOf(types, draft.typeId);

  const save = async (next: Draft) => {
    setDraft(next);
    try {
      await wiki.updatePage({
        id: page.id,
        title: next.title.trim() || page.title,
        typeId: next.typeId,
        categoryId: next.categoryId,
        tags: next.tags.split(",").map((s) => s.trim()).filter(Boolean),
        fields: next.fields,
        lang: next.lang,
      });
      onSaved();
    } catch (err) {
      onError(errorText(err));
    }
  };
  const setField = (def: FieldDef, value: string) => ({
    ...draft,
    fields: [...draft.fields.filter((f) => f.fieldId !== def.id), { fieldId: def.id, value }],
  });
  const leave = (e: React.KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && e.currentTarget.blur();

  return (
    <div className="page-details">
      <label className="detail detail-title">
        <span>{t("page.title")}</span>
        <input
          value={draft.title}
          disabled={!canEdit}
          maxLength={200}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          onBlur={() => draft.title.trim() !== page.title && save(draft)}
          onKeyDown={leave}
        />
      </label>
      <div className="detail-row">
        <label className="detail">
          <span>{t("page.type")}</span>
          <select value={draft.typeId} disabled={!page.canPublish} onChange={(e) => save({ ...draft, typeId: e.target.value })}>
            {!typeOf(types, draft.typeId) && <option value="">{t("page.noType")}</option>}
            {types.map((tp) => (
              <option key={tp.id} value={tp.id}>
                {tp.name}
              </option>
            ))}
          </select>
        </label>
        <label className="detail">
          <span>{t("page.category")}</span>
          <select value={draft.categoryId} disabled={!page.canPublish} onChange={(e) => save({ ...draft, categoryId: e.target.value })}>
            {categoryOptions(categories).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="detail">
          <span>{t("page.language")}</span>
          <select value={draft.lang} disabled={!page.canPublish} onChange={(e) => save({ ...draft, lang: e.target.value })}>
            <option value="">{t("page.anyLanguage")}</option>
            {LANGS.map((code) => (
              <option key={code} value={code}>
                {langName(code)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="detail">
        <span>{t("page.tags")}</span>
        <input
          value={draft.tags}
          disabled={!canEdit}
          placeholder={t("page.tagsHint")}
          onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
          onBlur={() => draft.tags !== page.tags.join(", ") && save(draft)}
          onKeyDown={leave}
        />
      </label>
      {type && type.fields.length > 0 && (
        <fieldset className="detail-fields">
          <legend>{t("page.infobox", { type: type.name })}</legend>
          {type.fields.map((def) => {
            const value = valueOf(draft.fields, def);
            const saved = valueOf(page.fields, def);
            return (
              <label key={def.id} className="detail">
                <span>{def.name}</span>
                {def.kind === FieldKind.FIELD_CHOICE ? (
                  <select value={value} disabled={!canEdit} onChange={(e) => save(setField(def, e.target.value))}>
                    <option value="">—</option>
                    {def.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : def.kind === FieldKind.FIELD_IMAGE ? (
                  <span className="detail-image">
                    {value && <img src={imageUrl(value)} alt="" />}
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() =>
                        uploadImage()
                          .then((uri) => {
                            if (uri) save(setField(def, uri));
                          })
                          .catch((err) => onError(errorText(err)))
                      }
                    >
                      <ImagePlus size={15} /> {value ? t("field.replaceImage") : t("field.addImage")}
                    </button>
                    {value && (
                      <button type="button" className="icon" title={t("field.removeImage")} disabled={!canEdit} onClick={() => save(setField(def, ""))}>
                        <X size={15} />
                      </button>
                    )}
                  </span>
                ) : (
                  <input
                    value={value}
                    disabled={!canEdit}
                    type={def.kind === FieldKind.FIELD_LINK ? "url" : "text"}
                    inputMode={def.kind === FieldKind.FIELD_NUMBER ? "decimal" : undefined}
                    placeholder={def.kind === FieldKind.FIELD_DATE ? t("field.datePlaceholder") : def.kind === FieldKind.FIELD_LINK ? "https://" : undefined}
                    onChange={(e) => setDraft(setField(def, e.target.value))}
                    onBlur={() => value !== saved && save(draft)}
                    onKeyDown={leave}
                  />
                )}
              </label>
            );
          })}
        </fieldset>
      )}
    </div>
  );
};

export default PageDetails;
