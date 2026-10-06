-- Read-only. Run the full query in Supabase SQL Editor before program-upgrade.sql.
-- Reports object presence, not a live test of policies or API behavior.
with checks(step,file,object_name,installed) as (values
 (0,'CHECK PROJECT: do not rerun setup.sql','public.rise_profiles',to_regclass('public.rise_profiles') is not null),
 (1,'staff-upgrade.sql','public.rise_questions / rise_answers',to_regclass('public.rise_questions') is not null and to_regclass('public.rise_answers') is not null),
 (2,'qa-upgrade.sql','public.rise_question_images',to_regclass('public.rise_question_images') is not null),
 (3,'course-assignments.sql','rise_work.classifications / entries',to_regclass('rise_work.classifications') is not null and to_regclass('rise_work.entries') is not null),
 (4,'training-course-management.sql','public.rise_training_manage(text,jsonb)',to_regprocedure('public.rise_training_manage(text,jsonb)') is not null),
 (5,'teacher-course-access.sql','rise_work.teacher_access / rise_private.teacher_student_access(uuid)',to_regclass('rise_work.teacher_access') is not null and to_regprocedure('rise_private.teacher_student_access(uuid)') is not null),
 (6,'watch-history.sql','public.rise_watch_sessions',to_regclass('public.rise_watch_sessions') is not null),
 (7,'question-advisor.sql','public.rise_advisor_usage',to_regclass('public.rise_advisor_usage') is not null)
)
select step as "順序", file as "前置檔案", object_name as "檢查項目",
 case when installed then '存在' else '缺少' end as "狀態",
 case when step>0 then 'https://raw.githubusercontent.com/youtingyeh/RISE/main/backend/'||file else null end as "SQL原始碼"
from checks order by step;
-- Install missing prerequisites in order. If course-assignments.sql is installed now,
-- reapply training-course-management.sql and teacher-course-access.sql afterwards.
-- If qa-upgrade.sql is installed now, reapply teacher-course-access.sql afterwards.
-- Finish with program-upgrade.sql. Never delete existing data or disable RLS.
