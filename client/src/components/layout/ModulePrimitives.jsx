import React from "react";

function cx(...values) {
  return values.filter(Boolean).join(" ");
}

export function ModuleHeader({
  eyebrow,
  title,
  description,
  badge,
  nextStep,
  stats = [],
  actions,
  className = "",
}) {
  return (
    <section className={cx("module-header", className)}>
      <div className="module-header__main">
        {eyebrow ? <span className="module-header__eyebrow">{eyebrow}</span> : null}

        <div className="module-header__title-row">
          <div>
            <h2 className="module-header__title">{title}</h2>
            {description ? (
              <p className="module-header__description">{description}</p>
            ) : null}
          </div>

          {badge ? <span className="module-header__badge">{badge}</span> : null}
        </div>

        {nextStep ? (
          <div className="module-header__next-step">
            <span className="module-header__next-label">Próxima ação</span>
            <span className="module-header__next-value">{nextStep}</span>
          </div>
        ) : null}

        {stats.length ? (
          <div className="module-header__stats">
            {stats.map((stat) => (
              <div key={stat.label} className="module-header__stat">
                <span className="module-header__stat-label">{stat.label}</span>
                <strong className="module-header__stat-value">{stat.value}</strong>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {actions ? <div className="module-header__actions">{actions}</div> : null}
    </section>
  );
}

export function SectionCard({
  title,
  description,
  eyebrow,
  actions,
  children,
  className = "",
  contentClassName = "",
}) {
  return (
    <section className={cx("section-card", className)}>
      {(title || description || eyebrow || actions) && (
        <header className="section-card__header">
          <div className="section-card__heading">
            {eyebrow ? <span className="section-card__eyebrow">{eyebrow}</span> : null}
            {title ? <h3 className="section-card__title">{title}</h3> : null}
            {description ? (
              <p className="section-card__description">{description}</p>
            ) : null}
          </div>

          {actions ? <div className="section-card__actions">{actions}</div> : null}
        </header>
      )}

      <div className={cx("section-card__content", contentClassName)}>{children}</div>
    </section>
  );
}

export function StickyActionBar({
  title,
  hint,
  primaryAction,
  secondaryActions,
  children,
  className = "",
}) {
  return (
    <div className={cx("sticky-action-bar", className)}>
      <div className="sticky-action-bar__copy">
        {title ? <strong className="sticky-action-bar__title">{title}</strong> : null}
        {hint ? <span className="sticky-action-bar__hint">{hint}</span> : null}
      </div>

      {children ? (
        <div className="sticky-action-bar__custom">{children}</div>
      ) : (
        <div className="sticky-action-bar__actions">
          {secondaryActions}
          {primaryAction}
        </div>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  tone = "default",
  className = "",
}) {
  return (
    <div className={cx("empty-state", `empty-state--${tone}`, className)}>
      <div className="empty-state__body">
        <strong className="empty-state__title">{title}</strong>
        {description ? (
          <p className="empty-state__description">{description}</p>
        ) : null}
      </div>

      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  );
}

export function InfoStrip({ items = [], className = "" }) {
  if (!items.length) return null;

  return (
    <div className={cx("info-strip", className)}>
      {items.map((item) => (
        <div key={item.label} className="info-strip__item">
          <span className="info-strip__label">{item.label}</span>
          <strong className="info-strip__value">{item.value}</strong>
          {item.helper ? <span className="info-strip__helper">{item.helper}</span> : null}
        </div>
      ))}
    </div>
  );
}
