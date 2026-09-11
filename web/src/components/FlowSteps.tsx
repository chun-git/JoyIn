export function FlowSteps({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="flow-card" aria-label={title}>
      <h3>{title}</h3>
      <ol className="flow-steps">
        {items.map((item, index) => (
          <li key={item}>
            <span className="flow-num" aria-hidden="true">
              {index + 1}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
