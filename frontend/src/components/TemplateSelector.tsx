import React from "react";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Chip,
  IconButton,
  Collapse,
  CardActionArea,
} from "@mui/material";
import Grid from "@mui/material/Grid";
import {
  ExpandMore,
  ExpandLess,
  AccountBalance,
  Assessment,
  Description,
  Gavel,
} from "@mui/icons-material";

interface Template {
  id: string;
  title: string;
  description: string;
  category: "lending" | "audit";
  query: string;
  icon?: React.ReactNode;
}

interface TemplateSelectorProps {
  onSelectTemplate: (template: Template) => void;
}

const lendingTemplates: Template[] = [
  {
    id: "lending-1",
    title: "Loan Portfolio Analysis",
    description:
      "Analyze the overall health and risk profile of the loan portfolio",
    category: "lending",
    query:
      "Analyze the loan portfolio health, including NPL ratios, concentration risks, and vintage analysis",
    icon: <AccountBalance />,
  },
  {
    id: "lending-2",
    title: "Credit Risk Assessment",
    description: "Evaluate borrower creditworthiness and default probabilities",
    category: "lending",
    query:
      "Perform a comprehensive credit risk assessment on the current loan book",
    icon: <Assessment />,
  },
  {
    id: "lending-3",
    title: "Collateral Valuation Review",
    description: "Review and validate collateral values and coverage ratios",
    category: "lending",
    query:
      "Review collateral valuations and calculate LTV ratios for secured loans",
    icon: <Description />,
  },
  {
    id: "lending-4",
    title: "Regulatory Compliance Check",
    description:
      "Verify compliance with lending regulations and capital requirements",
    category: "lending",
    query:
      "Check regulatory compliance for lending operations including capital adequacy and lending limits",
    icon: <Gavel />,
  },
  {
    id: "lending-5",
    title: "Interest Rate Risk Analysis",
    description: "Analyze exposure to interest rate fluctuations",
    category: "lending",
    query:
      "Analyze interest rate risk exposure and sensitivity across the loan portfolio",
  },
  {
    id: "lending-6",
    title: "Provision Coverage Review",
    description: "Assess adequacy of loan loss provisions",
    category: "lending",
    query:
      "Review loan loss provision coverage and adequacy based on portfolio risk",
  },
  {
    id: "lending-7",
    title: "Concentration Risk Analysis",
    description: "Identify and assess concentration risks in the portfolio",
    category: "lending",
    query:
      "Identify concentration risks by industry, geography, and borrower type",
  },
  {
    id: "lending-8",
    title: "Loan Covenant Monitoring",
    description: "Monitor compliance with loan covenants and conditions",
    category: "lending",
    query:
      "Review loan covenant compliance and identify any breaches or near-breaches",
  },
];

const auditTemplates: Template[] = [
  {
    id: "audit-1",
    title: "Financial Statement Validation",
    description: "Validate accuracy and completeness of financial statements",
    category: "audit",
    query:
      "Validate the accuracy and completeness of financial statements for the current period",
    icon: <Description />,
  },
  {
    id: "audit-2",
    title: "Internal Control Testing",
    description: "Test effectiveness of internal controls and procedures",
    category: "audit",
    query:
      "Test the effectiveness of internal controls over financial reporting",
    icon: <Assessment />,
  },
  {
    id: "audit-3",
    title: "Revenue Recognition Review",
    description: "Review revenue recognition policies and transactions",
    category: "audit",
    query:
      "Review revenue recognition policies and test key revenue transactions for compliance",
    icon: <AccountBalance />,
  },
  {
    id: "audit-4",
    title: "Expense Analysis",
    description: "Analyze expense categories for anomalies and compliance",
    category: "audit",
    query:
      "Perform detailed expense analysis to identify anomalies and verify compliance with policies",
  },
  {
    id: "audit-5",
    title: "Journal Entry Testing",
    description: "Test journal entries for unusual patterns or risks",
    category: "audit",
    query:
      "Test journal entries for unusual patterns, round amounts, and post-period adjustments",
  },
  {
    id: "audit-6",
    title: "Related Party Transactions",
    description: "Identify and review related party transactions",
    category: "audit",
    query:
      "Identify and review all related party transactions for proper disclosure and arm's length pricing",
  },
  {
    id: "audit-7",
    title: "Cash Flow Analysis",
    description: "Analyze cash flows and liquidity position",
    category: "audit",
    query:
      "Analyze cash flow statements and assess liquidity and going concern risks",
  },
  {
    id: "audit-8",
    title: "Compliance Testing",
    description: "Test compliance with laws and regulations",
    category: "audit",
    query:
      "Test compliance with applicable laws, regulations, and contractual obligations",
    icon: <Gavel />,
  },
];

export const TemplateSelector: React.FC<TemplateSelectorProps> = ({
  onSelectTemplate,
}) => {
  const [expandedCategory, setExpandedCategory] = React.useState<string | null>(
    "lending",
  );

  const handleCategoryToggle = (category: string) => {
    setExpandedCategory(expandedCategory === category ? null : category);
  };

  const renderTemplateCategory = (
    title: string,
    templates: Template[],
    category: "lending" | "audit",
    color: "primary" | "secondary",
  ) => (
    <Box sx={{ mb: 2 }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          mb: 1,
          cursor: "pointer",
          p: 1,
          borderRadius: 1,
          "&:hover": {
            backgroundColor: "action.hover",
          },
        }}
        onClick={() => handleCategoryToggle(category)}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="h6" color={`${color}.main`}>
            {title}
          </Typography>
          <Chip
            label={templates.length}
            size="small"
            color={color}
            sx={{ height: 20 }}
          />
        </Box>
        <IconButton size="small">
          {expandedCategory === category ? <ExpandLess /> : <ExpandMore />}
        </IconButton>
      </Box>

      <Collapse in={expandedCategory === category}>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          {templates.map((template) => (
            <Grid key={template.id} size={{ xs: 12, sm: 6, md: 4 }}>
              <Card
                variant="outlined"
                sx={{
                  height: "100%",
                  transition: "all 0.2s",
                  "&:hover": {
                    transform: "translateY(-2px)",
                    boxShadow: 2,
                    borderColor: `${color}.main`,
                  },
                }}
              >
                <CardActionArea
                  onClick={() => onSelectTemplate(template)}
                  sx={{ height: "100%" }}
                >
                  <CardContent>
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                        mb: 1,
                      }}
                    >
                      {template.icon && (
                        <Box sx={{ color: `${color}.main` }}>
                          {template.icon}
                        </Box>
                      )}
                      <Typography variant="subtitle1" fontWeight="medium">
                        {template.title}
                      </Typography>
                    </Box>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                      }}
                    >
                      {template.description}
                    </Typography>
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Collapse>
    </Box>
  );

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h5" sx={{ mb: 3 }}>
        Quick Templates
      </Typography>
      {renderTemplateCategory(
        "Lending Templates",
        lendingTemplates,
        "lending",
        "primary",
      )}
      {renderTemplateCategory(
        "Audit Templates",
        auditTemplates,
        "audit",
        "secondary",
      )}
    </Box>
  );
};
