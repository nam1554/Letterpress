/** SWR 공용 fetcher — 비 2xx는 throw 해서 useSWR의 error로 흐르게 한다. */
export async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json() as Promise<T>;
}
