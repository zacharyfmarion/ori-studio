import { Outlet } from 'react-router-dom';
import { useRouteLocale } from './useRouteLocale';

/**
 * The parent route of every `/<locale>/…` site page: it sets the language, and the pages
 * render inside it. The landing at `/zh-CN/` and the download page at `/zh-CN/download/`
 * share one instance of this, so moving between them does not flip the language off and
 * on again.
 */
export function SiteLocaleRoute({ locale }: { locale: string }) {
  useRouteLocale(locale);
  return <Outlet />;
}
