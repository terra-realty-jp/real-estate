-- ============================================================
-- Q&A 重複削除（seed-qa-all-wards.sql を2回実行した重複を解消）
-- Supabase SQL Editor で1回だけ実行してください
-- ============================================================
-- 各タイトルにつき「回答が付いている行を優先して1件だけ残し」残りを削除。
-- qa_answers は question_id の ON DELETE CASCADE で連動削除されるため、
-- 回答付きの行を残すことで回答を失わないようにする。

-- 1) 重複した質問を削除（タイトルごとに1件残す）
WITH ranked AS (
  SELECT q.id,
         ROW_NUMBER() OVER (
           PARTITION BY q.title
           ORDER BY (SELECT COUNT(*) FROM qa_answers a WHERE a.question_id = q.id) DESC,
                    q.created_at ASC
         ) AS rn
  FROM qa_questions q
)
DELETE FROM qa_questions
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 2) 重複した回答を削除（同一 question_id + body は1件に）
DELETE FROM qa_answers a
USING qa_answers b
WHERE a.question_id = b.question_id
  AND a.body = b.body
  AND a.id > b.id;

-- 3) 確認
SELECT 'questions(published)' AS t, COUNT(*) FROM qa_questions WHERE status = 'published'
UNION ALL SELECT 'questions(total)', COUNT(*) FROM qa_questions
UNION ALL SELECT 'answers', COUNT(*) FROM qa_answers;
