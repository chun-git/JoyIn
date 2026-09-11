import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FlowSteps } from '../components/FlowSteps';
import { SiteNav } from '../components/SiteNav';
import { getHelpSection, HELP_SECTIONS } from '../help/sections';

export function HelpPage() {
  const { section: sectionId } = useParams();
  const navigate = useNavigate();
  const requested = sectionId || 'start';
  const section = getHelpSection(requested);
  const known = HELP_SECTIONS.some((item) => item.id === requested);

  useEffect(() => {
    document.title = section ? `JoyIn 使用手冊｜${section.title}` : 'JoyIn 使用手冊';
    return () => {
      document.title = 'JoyIn 活動報名';
    };
  }, [section]);

  return (
    <div className="help-page">
      <a className="skip-link" href="#help-content">
        跳到內容
      </a>
      <SiteNav current="help" />
      <header className="help-hero">
        <p className="hint">公開說明，不需登入</p>
        <h1>使用手冊</h1>
        <p>群組看卡片，網頁完成報名與管理。以下依角色與步驟說明。</p>
      </header>

      <div className="help-layout">
        <nav className="help-toc" aria-label="使用手冊章節">
          <label className="help-toc-select">
            <span>選擇章節</span>
            <select
              value={known ? requested : ''}
              onChange={(event) => {
                const next = event.target.value;
                if (next) navigate(`/help/${next}`);
              }}
            >
              {!known ? <option value="">找不到這個章節</option> : null}
              {HELP_SECTIONS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <ul className="help-toc-list">
            {HELP_SECTIONS.map((item) => (
              <li key={item.id}>
                <Link to={`/help/${item.id}`} aria-current={item.id === requested ? 'page' : undefined}>
                  {item.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <main id="help-content">
          {!section || !known ? (
            <section className="panel" aria-labelledby="help-missing">
              <h2 id="help-missing">找不到這個章節</h2>
              <p className="hint">可能是連結打錯了。請從目錄選一個主題。</p>
              <div className="row">
                <Link to="/help/start" className="btn">
                  回到快速開始
                </Link>
              </div>
            </section>
          ) : (
            <article className="help-article" aria-labelledby={`help-${section.id}`}>
              <h2 id={`help-${section.id}`}>{section.title}</h2>
              <p>{section.summary}</p>
              {section.steps?.map((step, index) => (
                <section className="step-card" key={step.title}>
                  <span className="step-index" aria-hidden="true">
                    {index + 1}
                  </span>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.body}</p>
                  </div>
                </section>
              ))}
              {section.flows?.map((flow) => (
                <FlowSteps key={flow.title} title={flow.title} items={flow.items} />
              ))}
              {section.notes?.length ? (
                <ul className="help-notes">
                  {section.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              ) : null}
              {section.faqs?.length ? (
                <div className="faq-list">
                  {section.faqs.map((faq) => (
                    <details key={faq.question} className="faq-item">
                      <summary>{faq.question}</summary>
                      <p>{faq.answer}</p>
                    </details>
                  ))}
                </div>
              ) : null}
              {section.actions?.length ? (
                <div className="row help-actions">
                  {section.actions.map((action) => (
                    <Link
                      key={action.to + action.label}
                      to={action.to}
                      className={action.primary ? 'btn' : 'btn secondary'}
                    >
                      {action.label}
                    </Link>
                  ))}
                </div>
              ) : null}
            </article>
          )}
        </main>
      </div>
    </div>
  );
}
