import {
  Link as TanStackLink,
  Outlet,
  useLocation,
  useNavigate as useTanStackNavigate,
  useParams as useTanStackParams,
} from "@tanstack/react-router";
import {
  forwardRef,
  useCallback,
  useEffect,
  type AnchorHTMLAttributes,
  type ReactNode,
} from "react";

type NavigateOptions = { replace?: boolean };
type SearchParamsInit = URLSearchParams | string | Record<string, string>;

export { Outlet, useLocation };

/**
 * Compatibility surface for the existing application components while the
 * application router is powered by TanStack Router.
 */
export function useNavigate() {
  const navigate = useTanStackNavigate();

  return useCallback(
    (to: string, options?: NavigateOptions) =>
      navigate({ to: to as never, replace: options?.replace }),
    [navigate],
  );
}

export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>() {
  return (useTanStackParams as (options?: unknown) => unknown)({ strict: false }) as T;
}

export function useSearchParams(): [URLSearchParams, (next: SearchParamsInit, options?: NavigateOptions) => void] {
  const location = useLocation();
  const navigate = useTanStackNavigate();
  const searchParams = new URLSearchParams(location.search as Record<string, string>);

  const setSearchParams = useCallback(
    (next: SearchParamsInit, options?: NavigateOptions) => {
      const params = new URLSearchParams(next);
      (navigate as (options: unknown) => void)({
        search: Object.fromEntries(params.entries()),
        replace: options?.replace,
      });
    },
    [navigate],
  );

  return [searchParams, setSearchParams];
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  to: string;
  children?: ReactNode;
  replace?: boolean;
};

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { to, replace, ...props },
  ref,
) {
  return <TanStackLink ref={ref} to={to as never} replace={replace} {...props} />;
});

export function Navigate({ to, replace }: { to: string; replace?: boolean }) {
  const navigate = useNavigate();

  useEffect(() => {
    navigate(to, { replace });
  }, [navigate, replace, to]);

  return null;
}
