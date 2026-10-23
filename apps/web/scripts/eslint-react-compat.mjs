// SPDX-License-Identifier: MIT
// Adapted from eslint-plugin-react@7.37.5 (Yannick Croissant, Scott Feeney,
// Sergei Startsev). Keep the upstream deprecation table and visitors intact.
// ESLint 10-compatible utilities below replace the legacy plugin dependencies.
// See eslint-react-compat.LICENSE and the differential fixtures captured from
// the original rule before upgrading ESLint.
import { createRequire } from "node:module";
import semver from "semver";
import doctrine from "doctrine";

const require = createRequire(import.meta.url);
const entries = Object.entries;
const docsUrl = (name) =>
  `https://github.com/jsx-eslint/eslint-plugin-react/blob/v7.37.5/docs/rules/${name}.md`;
const getText = (context, node) => context.sourceCode.getText(node);
const report = (context, _message, messageId, options) =>
  context.report({ messageId, ...options });
const testReactVersion = (context, range) => {
  const configured = context.settings.react?.version;
  const version =
    configured && configured !== "detect"
      ? configured
      : require("react/package.json").version;
  return semver.satisfies(version, range);
};
const pragmaUtil = {
  getFromContext(context) {
    const comment = context.sourceCode
      .getAllComments()
      .find(({ value }) => /@jsx\s+([^\s]+)/.test(value));
    const pragma = comment
      ? /@jsx\s+([^\s]+)/.exec(comment.value)[1].split(".")[0]
      : (context.settings.react?.pragma ?? "React");
    return /^[_$a-zA-Z][_$a-zA-Z0-9]*$/.test(pragma) ? pragma : "React";
  },
};
const astUtil = {
  getComponentProperties: (node) =>
    node.type === "ObjectExpression"
      ? node.properties
      : (node.body?.body ?? []),
  getPropertyNameNode: (node) =>
    node.key ?? (node.type === "MemberExpression" ? node.property : null),
  getPropertyName(node) {
    return this.getPropertyNameNode(node)?.name ?? "";
  },
};
function hasReactClassAnnotation(node, sourceCode) {
  // Class expressions inherit the declaration's JSDoc, matching ESLint 9.
  const declaration =
    node.type === "ClassExpression"
      ? node.parent?.parent
      : node.type === "ClassDeclaration"
        ? node.parent?.type?.startsWith("Export")
          ? node.parent
          : node
        : null;
  if (!declaration) return false;
  const comment = sourceCode.getTokenBefore(declaration, {
    includeComments: true,
  });
  if (
    comment?.type !== "Block" ||
    !comment.value.startsWith("*") ||
    declaration.loc.start.line - comment.loc.end.line > 1
  )
    return false;
  try {
    const { tags } = doctrine.parse(comment.value, {
      unwrap: true,
      tags: ["extends", "augments"],
    });
    return tags.some(
      ({ name }) =>
        name === "React.Component" || name === "React.PureComponent",
    );
  } catch {
    return false;
  }
}
const componentUtil = {
  isES5Component(node, context) {
    const callee = node.parent?.callee;
    const createClass =
      context.settings.react?.createClass ?? "createReactClass";
    if (!/^[_$a-zA-Z][_$a-zA-Z0-9]*$/.test(createClass))
      throw new Error("Invalid React createClass pragma");
    return callee?.type === "MemberExpression"
      ? callee.object.name === pragmaUtil.getFromContext(context) &&
          callee.property.name === createClass
      : callee?.type === "Identifier" && callee.name === createClass;
  },
  isES6Component(node, context) {
    if (hasReactClassAnnotation(node, context.sourceCode)) return true;
    const parent = node.superClass;
    return parent?.type === "MemberExpression"
      ? parent.object.name === pragmaUtil.getFromContext(context) &&
          /^(Pure)?Component$/.test(parent.property.name)
      : parent?.type === "Identifier" && /^(Pure)?Component$/.test(parent.name);
  },
};

const MODULES = {
  react: ["React"],
  "react-addons-perf": ["ReactPerf", "Perf"],
  "react-dom": ["ReactDOM"],
  "react-dom/server": ["ReactDOMServer"],
};

// ------------------------------------------------------------------------------
// Rule Definition
// ------------------------------------------------------------------------------

function getDeprecated(pragma) {
  const deprecated = {};
  // 0.12.0
  deprecated[`${pragma}.renderComponent`] = ["0.12.0", `${pragma}.render`];
  deprecated[`${pragma}.renderComponentToString`] = [
    "0.12.0",
    `${pragma}.renderToString`,
  ];
  deprecated[`${pragma}.renderComponentToStaticMarkup`] = [
    "0.12.0",
    `${pragma}.renderToStaticMarkup`,
  ];
  deprecated[`${pragma}.isValidComponent`] = [
    "0.12.0",
    `${pragma}.isValidElement`,
  ];
  deprecated[`${pragma}.PropTypes.component`] = [
    "0.12.0",
    `${pragma}.PropTypes.element`,
  ];
  deprecated[`${pragma}.PropTypes.renderable`] = [
    "0.12.0",
    `${pragma}.PropTypes.node`,
  ];
  deprecated[`${pragma}.isValidClass`] = ["0.12.0"];
  deprecated["this.transferPropsTo"] = ["0.12.0", "spread operator ({...})"];
  // 0.13.0
  deprecated[`${pragma}.addons.classSet`] = [
    "0.13.0",
    "the npm module classnames",
  ];
  deprecated[`${pragma}.addons.cloneWithProps`] = [
    "0.13.0",
    `${pragma}.cloneElement`,
  ];
  // 0.14.0
  deprecated[`${pragma}.render`] = ["0.14.0", "ReactDOM.render"];
  deprecated[`${pragma}.unmountComponentAtNode`] = [
    "0.14.0",
    "ReactDOM.unmountComponentAtNode",
  ];
  deprecated[`${pragma}.findDOMNode`] = ["0.14.0", "ReactDOM.findDOMNode"];
  deprecated[`${pragma}.renderToString`] = [
    "0.14.0",
    "ReactDOMServer.renderToString",
  ];
  deprecated[`${pragma}.renderToStaticMarkup`] = [
    "0.14.0",
    "ReactDOMServer.renderToStaticMarkup",
  ];
  // 15.0.0
  deprecated[`${pragma}.addons.LinkedStateMixin`] = ["15.0.0"];
  deprecated["ReactPerf.printDOM"] = ["15.0.0", "ReactPerf.printOperations"];
  deprecated["Perf.printDOM"] = ["15.0.0", "Perf.printOperations"];
  deprecated["ReactPerf.getMeasurementsSummaryMap"] = [
    "15.0.0",
    "ReactPerf.getWasted",
  ];
  deprecated["Perf.getMeasurementsSummaryMap"] = ["15.0.0", "Perf.getWasted"];
  // 15.5.0
  deprecated[`${pragma}.createClass`] = [
    "15.5.0",
    "the npm module create-react-class",
  ];
  deprecated[`${pragma}.addons.TestUtils`] = ["15.5.0", "ReactDOM.TestUtils"];
  deprecated[`${pragma}.PropTypes`] = ["15.5.0", "the npm module prop-types"];
  // 15.6.0
  deprecated[`${pragma}.DOM`] = [
    "15.6.0",
    "the npm module react-dom-factories",
  ];
  // 16.9.0
  // For now the following life-cycle methods are just legacy, not deprecated:
  // `componentWillMount`, `componentWillReceiveProps`, `componentWillUpdate`
  // https://github.com/yannickcr/eslint-plugin-react/pull/1750#issuecomment-425975934
  deprecated.componentWillMount = [
    "16.9.0",
    "UNSAFE_componentWillMount",
    "https://reactjs.org/docs/react-component.html#unsafe_componentwillmount. " +
      "Use https://github.com/reactjs/react-codemod#rename-unsafe-lifecycles to automatically update your components.",
  ];
  deprecated.componentWillReceiveProps = [
    "16.9.0",
    "UNSAFE_componentWillReceiveProps",
    "https://reactjs.org/docs/react-component.html#unsafe_componentwillreceiveprops. " +
      "Use https://github.com/reactjs/react-codemod#rename-unsafe-lifecycles to automatically update your components.",
  ];
  deprecated.componentWillUpdate = [
    "16.9.0",
    "UNSAFE_componentWillUpdate",
    "https://reactjs.org/docs/react-component.html#unsafe_componentwillupdate. " +
      "Use https://github.com/reactjs/react-codemod#rename-unsafe-lifecycles to automatically update your components.",
  ];
  // 18.0.0
  // https://reactjs.org/blog/2022/03/08/react-18-upgrade-guide.html#deprecations
  deprecated["ReactDOM.render"] = [
    "18.0.0",
    "createRoot",
    "https://reactjs.org/link/switch-to-createroot",
  ];
  deprecated["ReactDOM.hydrate"] = [
    "18.0.0",
    "hydrateRoot",
    "https://reactjs.org/link/switch-to-createroot",
  ];
  deprecated["ReactDOM.unmountComponentAtNode"] = [
    "18.0.0",
    "root.unmount",
    "https://reactjs.org/link/switch-to-createroot",
  ];
  deprecated["ReactDOMServer.renderToNodeStream"] = [
    "18.0.0",
    "renderToPipeableStream",
    "https://reactjs.org/docs/react-dom-server.html#rendertonodestream",
  ];

  return deprecated;
}

const messages = {
  deprecated:
    "{{oldMethod}} is deprecated since React {{version}}{{newMethod}}{{refs}}",
};

/** @type {import('eslint').Rule.RuleModule} */
const noDeprecated = {
  meta: {
    docs: {
      description: "Disallow usage of deprecated methods",
      category: "Best Practices",
      recommended: true,
      url: docsUrl("no-deprecated"),
    },

    messages,

    schema: [],
  },

  create(context) {
    const pragma = pragmaUtil.getFromContext(context);
    const deprecated = getDeprecated(pragma);

    function isDeprecated(method) {
      return (
        deprecated &&
        deprecated[method] &&
        deprecated[method][0] &&
        testReactVersion(context, `>= ${deprecated[method][0]}`)
      );
    }

    function checkDeprecation(node, methodName, methodNode) {
      if (!isDeprecated(methodName)) {
        return;
      }
      const version = deprecated[methodName][0];
      const newMethod = deprecated[methodName][1];
      const refs = deprecated[methodName][2];
      report(context, messages.deprecated, "deprecated", {
        node: methodNode || node,
        data: {
          oldMethod: methodName,
          version,
          newMethod: newMethod ? `, use ${newMethod} instead` : "",
          refs: refs ? `, see ${refs}` : "",
        },
      });
    }

    function getReactModuleName(node) {
      let moduleName = false;
      if (!node.init) {
        return false;
      }

      entries(MODULES).some((entry) => {
        const key = entry[0];
        const moduleNames = entry[1];
        if (
          node.init.arguments &&
          node.init.arguments.length > 0 &&
          node.init.arguments[0] &&
          key === node.init.arguments[0].value
        ) {
          moduleName = MODULES[key][0];
        } else {
          moduleName = moduleNames.find((name) => name === node.init.name);
        }
        return moduleName;
      });

      return moduleName;
    }

    /**
     * Returns life cycle methods if available
     * @param {ASTNode} node The AST node being checked.
     * @returns {Array} The array of methods.
     */
    function getLifeCycleMethods(node) {
      const properties = astUtil.getComponentProperties(node);
      return properties.map((property) => ({
        name: astUtil.getPropertyName(property),
        node: astUtil.getPropertyNameNode(property),
      }));
    }

    /**
     * Checks life cycle methods
     * @param {ASTNode} node The AST node being checked.
     */
    function checkLifeCycleMethods(node) {
      if (
        componentUtil.isES5Component(node, context) ||
        componentUtil.isES6Component(node, context)
      ) {
        const methods = getLifeCycleMethods(node);
        methods.forEach((method) =>
          checkDeprecation(node, method.name, method.node),
        );
      }
    }

    // --------------------------------------------------------------------------
    // Public
    // --------------------------------------------------------------------------

    return {
      MemberExpression(node) {
        checkDeprecation(node, getText(context, node));
      },

      ImportDeclaration(node) {
        const isReactImport = typeof MODULES[node.source.value] !== "undefined";
        if (!isReactImport) {
          return;
        }
        node.specifiers
          .filter((s) => "imported" in s && s.imported)
          .forEach((specifier) => {
            // TODO, semver-major: remove `in` check as part of jsdoc->tsdoc migration
            checkDeprecation(
              node,
              "imported" in specifier &&
                "name" in specifier.imported &&
                `${MODULES[node.source.value][0]}.${specifier.imported.name}`,
              specifier,
            );
          });
      },

      VariableDeclarator(node) {
        const reactModuleName = getReactModuleName(node);
        const isRequire =
          node.init &&
          "callee" in node.init &&
          node.init.callee &&
          "name" in node.init.callee &&
          node.init.callee.name === "require";
        const isReactRequire =
          node.init &&
          "arguments" in node.init &&
          node.init.arguments &&
          node.init.arguments.length &&
          typeof MODULES[
            "value" in node.init.arguments[0]
              ? node.init.arguments[0].value
              : undefined
          ] !== "undefined";
        const isDestructuring = node.id && node.id.type === "ObjectPattern";

        if (
          !(isDestructuring && reactModuleName) &&
          !(isDestructuring && isRequire && isReactRequire)
        ) {
          return;
        }

        ("properties" in node.id ? node.id.properties : undefined)
          .filter((p) => p.type !== "RestElement" && p.key)
          .forEach((property) => {
            checkDeprecation(
              node,
              "key" in property &&
                "name" in property.key &&
                `${reactModuleName || pragma}.${property.key.name}`,
              property,
            );
          });
      },

      ClassDeclaration: checkLifeCycleMethods,
      ClassExpression: checkLifeCycleMethods,
      ObjectExpression: checkLifeCycleMethods,
    };
  },
};

export default { rules: { "no-deprecated": noDeprecated } };
