WITH views AS (SELECT COUNT(DISTINCT session_id) AS n FROM events WHERE name = 'demo_view'),
reached AS (
  SELECT name, COUNT(DISTINCT session_id) AS sessions FROM events
  WHERE name IN ('demo_view', 'demo_step_1', 'demo_step_2', 'demo_step_3', 'demo_step_4', 'demo_step_5', 'signup_click')
  GROUP BY name
),
furthest AS (
  SELECT session_id, MAX(CAST(substr(name, 11) AS INTEGER)) AS step
  FROM events WHERE name GLOB 'demo_step_[1-5]' GROUP BY session_id
),
stopped AS (
  SELECT 'demo_step_' || step AS name, COUNT(*) AS stopped_here
  FROM furthest
  WHERE session_id NOT IN (SELECT session_id FROM events WHERE name = 'signup_click' AND session_id IS NOT NULL)
  GROUP BY step
)
SELECT r.name, r.sessions,
  ROUND(100.0 * r.sessions / NULLIF(v.n, 0), 1) AS pct_of_views,
  COALESCE(st.stopped_here, 0) AS stopped_here_without_signup_click
FROM reached r CROSS JOIN views v LEFT JOIN stopped st ON st.name = r.name
ORDER BY CASE r.name WHEN 'demo_view' THEN 0 WHEN 'signup_click' THEN 9 ELSE CAST(substr(r.name, 11) AS INTEGER) END;
