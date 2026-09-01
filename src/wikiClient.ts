export type PageListItem = {
  id: number;
  path: string;
  title: string;
  description: string;
  isPublished: boolean;
  locale: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export type Page = {
  id: number;
  path: string;
  hash: string;
  title: string;
  description: string;
  content: string;
  editor: string;
  locale: string;
  authorName: string;
  creatorName: string;
  isPublished: boolean;
  tags: { tag: string; title: string }[];
  createdAt: string;
  updatedAt: string;
};

export type SearchResult = {
  results: { id: string; title: string; description: string; path: string; locale: string }[];
  suggestions: string[];
  totalHits: number;
};

export type MutationResult = {
  responseResult: {
    succeeded: boolean;
    errorCode: number;
    slug: string;
    message: string;
  };
  page?: { id: number; path: string; title: string } | null;
};

const PAGE_FIELDS = `
  id
  path
  hash
  title
  description
  content
  editor
  locale
  authorName
  creatorName
  isPublished
  tags { tag title }
  createdAt
  updatedAt
`;

export class WikiJsClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private async graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/graphql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch (error) {
      throw new Error(
        `Could not reach Wiki.js at ${this.baseUrl}: ${(error as Error).message}. Check WIKIJS_BASE_URL and network connectivity.`,
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Wiki.js rejected the request (HTTP ${response.status}). The API key is invalid or the API is disabled. In Wiki.js go to Administration → API Access, enable the API and create a valid key.`,
      );
    }

    const text = await response.text();
    let payload: { data?: T; errors?: { message: string }[] } | null = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`Wiki.js returned a non-JSON response (HTTP ${response.status}): ${text.slice(0, 300)}`);
    }

    if (payload?.errors?.length) {
      throw new Error(`Wiki.js GraphQL error: ${payload.errors.map((e) => e.message).join('; ')}`);
    }

    if (!response.ok || !payload?.data) {
      throw new Error(`Wiki.js request failed (HTTP ${response.status} ${response.statusText}).`);
    }

    return payload.data;
  }

  private assertMutationSucceeded(result: MutationResult, hint: string): void {
    const rr = result.responseResult;
    if (!rr.succeeded) {
      throw new Error(`Wiki.js refused the operation: ${rr.message} (code ${rr.errorCode}, ${rr.slug}). ${hint}`);
    }
  }

  async listPages(params: { limit?: number; orderBy?: string; tags?: string[]; locale?: string } = {}) {
    const data = await this.graphql<{ pages: { list: PageListItem[] } }>(
      `query ($limit: Int, $orderBy: PageOrderBy, $tags: [String!], $locale: String) {
        pages {
          list(limit: $limit, orderBy: $orderBy, tags: $tags, locale: $locale) {
            id path title description isPublished locale tags createdAt updatedAt
          }
        }
      }`,
      {
        limit: params.limit,
        orderBy: params.orderBy,
        tags: params.tags,
        locale: params.locale,
      },
    );
    return data.pages.list;
  }

  async getPageById(id: number) {
    const data = await this.graphql<{ pages: { single: Page | null } }>(
      `query ($id: Int!) {
        pages { single(id: $id) { ${PAGE_FIELDS} } }
      }`,
      { id },
    );
    if (!data.pages.single) {
      throw new Error(`No page with id ${id} found. Use wiki_list_pages or wiki_search to find valid page ids.`);
    }
    return data.pages.single;
  }

  async getPageByPath(path: string, locale: string) {
    const data = await this.graphql<{ pages: { singleByPath: Page | null } }>(
      `query ($path: String!, $locale: String!) {
        pages { singleByPath(path: $path, locale: $locale) { ${PAGE_FIELDS} } }
      }`,
      { path, locale },
    );
    if (!data.pages.singleByPath) {
      throw new Error(
        `No page found at path "${path}" (locale "${locale}"). The path must not include a leading slash or the locale prefix. Use wiki_search to find the correct path.`,
      );
    }
    return data.pages.singleByPath;
  }

  async searchPages(query: string, path?: string, locale?: string) {
    const data = await this.graphql<{ pages: { search: SearchResult } }>(
      `query ($query: String!, $path: String, $locale: String) {
        pages {
          search(query: $query, path: $path, locale: $locale) {
            results { id title description path locale }
            suggestions
            totalHits
          }
        }
      }`,
      { query, path, locale },
    );
    return data.pages.search;
  }

  async createPage(input: {
    title: string;
    path: string;
    content: string;
    description: string;
    editor: string;
    isPublished: boolean;
    locale: string;
    tags: string[];
  }) {
    const data = await this.graphql<{ pages: { create: MutationResult } }>(
      `mutation (
        $content: String!, $description: String!, $editor: String!, $isPublished: Boolean!,
        $isPrivate: Boolean!, $locale: String!, $path: String!, $tags: [String]!, $title: String!
      ) {
        pages {
          create(
            content: $content, description: $description, editor: $editor, isPublished: $isPublished,
            isPrivate: $isPrivate, locale: $locale, path: $path, tags: $tags, title: $title
          ) {
            responseResult { succeeded errorCode slug message }
            page { id path title }
          }
        }
      }`,
      { ...input, isPrivate: false },
    );
    this.assertMutationSucceeded(
      data.pages.create,
      'If the path already exists, use wiki_update_page instead of creating a duplicate.',
    );
    return data.pages.create.page!;
  }

  async updatePage(
    id: number,
    input: {
      title?: string;
      path?: string;
      content?: string;
      description?: string;
      isPublished?: boolean;
      locale?: string;
      tags?: string[];
    },
  ) {
    const variables: Record<string, unknown> = { id };
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) variables[key] = value;
    }
    const data = await this.graphql<{ pages: { update: MutationResult } }>(
      `mutation (
        $id: Int!, $content: String, $description: String, $isPublished: Boolean,
        $locale: String, $path: String, $tags: [String], $title: String
      ) {
        pages {
          update(
            id: $id, content: $content, description: $description, isPublished: $isPublished,
            locale: $locale, path: $path, tags: $tags, title: $title
          ) {
            responseResult { succeeded errorCode slug message }
            page { id path title }
          }
        }
      }`,
      variables,
    );
    this.assertMutationSucceeded(
      data.pages.update,
      'Verify the page id with wiki_get_page or wiki_search.',
    );
    return data.pages.update.page ?? { id };
  }

  async deletePage(id: number) {
    const data = await this.graphql<{ pages: { delete: { responseResult: MutationResult['responseResult'] } } }>(
      `mutation ($id: Int!) {
        pages {
          delete(id: $id) {
            responseResult { succeeded errorCode slug message }
          }
        }
      }`,
      { id },
    );
    const rr = data.pages.delete.responseResult;
    if (!rr.succeeded) {
      throw new Error(
        `Wiki.js refused to delete page ${id}: ${rr.message} (code ${rr.errorCode}). Verify the id with wiki_list_pages.`,
      );
    }
    return { id, deleted: true };
  }
}
