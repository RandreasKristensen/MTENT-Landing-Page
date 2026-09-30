WITH e AS (
  SELECT COALESCE(src, '(none)') AS src,
    COUNT(DISTINCT CASE WHEN name = 'demo_view'    THEN session_id END) AS demo_view,
    COUNT(DISTINCT CASE WHEN name = 'demo_step_5'  THEN session_id END) AS demo_step_5,
    COUNT(DISTINCT CASE WHEN name = 'signup_click' THEN session_id END) AS signup_click,
    COUNT(DISTINCT CASE WHEN name = 'signup_view'  THEN session_id END) AS signup_view
  FROM events GROUP BY 1
),
s AS (SELECT COALESCE(src, '(none)') AS src, COUNT(*) AS signups FROM signups GROUP BY 1),
k AS (SELECT src FROM e UNION SELECT src FROM s)
SELECT k.src,
  COALESCE(e.demo_view, 0)    AS demo_view,
  COALESCE(e.demo_step_5, 0)  AS demo_step_5,
  COALESCE(e.signup_click, 0) AS signup_click,
  COALESCE(e.signup_view, 0)  AS signup_view,
  COALESCE(s.signups, 0)      AS signups,
  ROUND(100.0 * COALESCE(s.signups, 0) / NULLIF(e.demo_view, 0), 1) AS pct_view_to_signup
FROM k LEFT JOIN e ON e.src = k.src LEFT JOIN s ON s.src = k.src
ORDER BY demo_view DESC, signups DESC;
