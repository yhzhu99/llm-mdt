import './StageCard.css';

export default function StageCard({ title, subtitle, right, children, className = '' }) {
  return (
    <section className={`stage-card ${className}`}>
      <div className="stage-card-header">
        <div>
          <h3 className="stage-card-title">{title}</h3>
          {subtitle ? <p className="stage-card-subtitle">{subtitle}</p> : null}
        </div>
        {right ? <div>{right}</div> : null}
      </div>
      <div className="stage-card-body">{children}</div>
    </section>
  );
}

