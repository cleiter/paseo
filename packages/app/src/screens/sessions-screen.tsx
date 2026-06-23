import { useMemo, useState, useCallback, useEffect } from "react";
import { View, Text, TextInput, Pressable, Keyboard } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { router } from "expo-router";
import { StyleSheet, useUnistyles, withUnistyles } from "react-native-unistyles";
import { ChevronLeft, Search, X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { AgentList } from "@/components/agent-list";
import { useAgentHistory } from "@/hooks/use-agent-history";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { filterAgentsByQuery } from "@/utils/agent-search";
import { buildHostOpenProjectRoute } from "@/utils/host-routes";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";

const SEARCH_ICON_SIZE = 16;
// Filter from the first character (instant feel); positive queries are debounced.
const MIN_QUERY_LENGTH = 1;
const DEBOUNCE_MS = 150;

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedSearch = withUnistyles(Search);
const ThemedX = withUnistyles(X);
const ThemedTextInput = withUnistyles(TextInput, (theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));

export function SessionsScreen({ serverId }: { serverId: string }) {
  const isFocused = useIsFocused();

  if (!isFocused) {
    return <View style={styles.container} />;
  }

  return <SessionsScreenContent serverId={serverId} />;
}

function SessionsScreenContent({ serverId }: { serverId: string }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const { agents, hasMore, isInitialLoad, isLoadingMore, isRevalidating, loadMore, refreshAll } =
    useAgentHistory({
      serverId,
    });

  // Track user-initiated refresh to avoid showing spinner on background revalidation
  const [isManualRefresh, setIsManualRefresh] = useState(false);

  const handleRefresh = useCallback(() => {
    setIsManualRefresh(true);
    refreshAll();
  }, [refreshAll]);

  // Reset manual refresh flag when revalidation completes
  useEffect(() => {
    if (!isRevalidating && isManualRefresh) {
      setIsManualRefresh(false);
    }
  }, [isRevalidating, isManualRefresh]);

  // Raw query drives the input (always responsive). Gate the filter on the RAW length so
  // clearing or dropping below the minimum resets the list immediately, while positive
  // queries are debounced.
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);
  const effectiveQuery = query.trim().length < MIN_QUERY_LENGTH ? "" : debouncedQuery.trim();
  const isSearching = effectiveQuery.length > 0;

  const sortedAgents = useMemo(() => {
    return [...agents].sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
  }, [agents]);

  const filteredAgents = useMemo(
    () => filterAgentsByQuery(sortedAgents, effectiveQuery),
    [sortedAgents, effectiveQuery],
  );

  // When a search yields nothing, dismiss the keyboard so the empty state isn't hidden behind it.
  const noMatches = isSearching && filteredAgents.length === 0;
  useEffect(() => {
    if (noMatches) {
      Keyboard.dismiss();
    }
  }, [noMatches]);

  const handleBack = useCallback(() => {
    router.navigate(buildHostOpenProjectRoute(serverId));
  }, [serverId]);

  const handleClearSearch = useCallback(() => setQuery(""), []);

  const listFooterComponent = useMemo(
    () =>
      hasMore ? (
        <View style={styles.footer}>
          {isSearching ? (
            <Text style={styles.footerHint}>{t("sessions.search.loadMoreHint")}</Text>
          ) : null}
          <Button variant="ghost" onPress={loadMore} disabled={isLoadingMore}>
            {isLoadingMore ? t("common.loading") : t("sessions.actions.loadMore")}
          </Button>
        </View>
      ) : null,
    [hasMore, isSearching, loadMore, isLoadingMore, t],
  );

  const searchField = (
    <View style={styles.searchField}>
      <View style={styles.searchIcon}>
        <ThemedSearch size={SEARCH_ICON_SIZE} uniProps={foregroundMutedColorMapping} />
      </View>
      <ThemedTextInput
        testID="sessions-search"
        value={query}
        onChangeText={setQuery}
        placeholder={t("sessions.search.placeholder")}
        accessibilityLabel={t("sessions.search.placeholder")}
        // @ts-expect-error - outlineStyle is web-only
        style={SEARCH_INPUT_STYLE}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        onSubmitEditing={Keyboard.dismiss}
      />
      {query.length > 0 ? (
        <Pressable
          onPress={handleClearSearch}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t("sessions.search.clear")}
          style={styles.clearButton}
          testID="sessions-search-clear"
        >
          <ThemedX size={SEARCH_ICON_SIZE} uniProps={foregroundMutedColorMapping} />
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <View style={styles.container}>
      <MenuHeader title={t("sessions.title")} />
      {isInitialLoad ? (
        <View style={styles.loadingContainer}>
          <LoadingSpinner size="large" color={theme.colors.foregroundMuted} />
        </View>
      ) : null}
      {!isInitialLoad && sortedAgents.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>{t("sessions.empty")}</Text>
          <Button variant="ghost" leftIcon={ChevronLeft} onPress={handleBack}>
            {t("common.actions.back")}
          </Button>
        </View>
      ) : null}
      {!isInitialLoad && sortedAgents.length > 0 ? (
        <View style={styles.content}>
          {searchField}
          {filteredAgents.length > 0 ? (
            <AgentList
              agents={filteredAgents}
              showCheckoutInfo={false}
              isRefreshing={isManualRefresh && isRevalidating}
              onRefresh={handleRefresh}
              listFooterComponent={listFooterComponent}
              showAttentionIndicator={false}
            />
          ) : (
            <View style={styles.noResultsContainer}>
              <Text style={styles.emptyText}>{t("sessions.search.noResults")}</Text>
              <Button variant="ghost" onPress={handleClearSearch}>
                {t("sessions.search.clear")}
              </Button>
              {hasMore ? (
                <View style={styles.noResultsLoadMore}>
                  <Text style={styles.footerHint}>{t("sessions.search.loadMoreHint")}</Text>
                  <Button variant="ghost" onPress={loadMore} disabled={isLoadingMore}>
                    {isLoadingMore ? t("common.loading") : t("sessions.actions.loadMore")}
                  </Button>
                </View>
              ) : null}
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  content: {
    flex: 1,
    minHeight: 0,
  },
  searchField: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing[3],
    marginTop: theme.spacing[3],
    marginBottom: theme.spacing[2],
    marginHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[6],
    },
  },
  searchIcon: {
    width: 18,
    alignItems: "center",
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: theme.spacing[3],
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  clearButton: {
    padding: theme.spacing[1],
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: theme.spacing[6],
    padding: theme.spacing[6],
  },
  noResultsContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: theme.spacing[4],
    padding: theme.spacing[6],
  },
  noResultsLoadMore: {
    alignItems: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.lg,
  },
  footerHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    textAlign: "center",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  footer: {
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[4],
  },
}));

const SEARCH_INPUT_STYLE = [styles.searchInput, isWeb && { outlineStyle: "none" }];
