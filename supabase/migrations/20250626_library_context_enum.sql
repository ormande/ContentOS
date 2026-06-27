-- Rode no Supabase SQL Editor antes de npm run seed:library
alter type public.library_context add value if not exists 'trend';
alter type public.library_context add value if not exists 'ranking';
alter type public.library_context add value if not exists 'react';
alter type public.library_context add value if not exists 'tutorial';
alter type public.library_context add value if not exists 'yapper';
