import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export function useProgressiveList(items, pageSize = 12) {
  const [visibleState, setVisibleState] = useState(() => ({
    items,
    count: pageSize,
  }));
  const visibleCount =
    visibleState.items === items ? visibleState.count : pageSize;
  const sentinelRef = useRef(null);
  const hasMore = visibleCount < items.length;

  const loadMore = useCallback(() => {
    setVisibleState((current) => {
      const currentCount =
        current.items === items ? current.count : pageSize;
      return {
        items,
        count: Math.min(currentCount + pageSize, items.length),
      };
    });
  }, [items, pageSize]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || typeof IntersectionObserver === 'undefined') {
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadMore();
      },
      { rootMargin: '240px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  const visibleItems = useMemo(
    () => items.slice(0, visibleCount),
    [items, visibleCount]
  );

  return { visibleItems, visibleCount: visibleItems.length, hasMore, loadMore, sentinelRef };
}
