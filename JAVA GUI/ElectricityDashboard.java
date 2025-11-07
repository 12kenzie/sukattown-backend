
import java.awt.*;
import java.awt.event.*;
import java.awt.geom.*;
import javax.swing.*;
import javax.swing.border.*;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

public class ElectricityDashboard extends JFrame { // create main window

    // Color scheme
    private static final Color BG_COLOR = new Color(246, 239, 239);
    private static final Color CARD_COLOR = Color.WHITE;
    private static final Color MUTED_COLOR = new Color(102, 112, 133);
    private static final Color ACCENT_1 = new Color(107, 83, 245);
    private static final Color ACCENT_2 = new Color(163, 78, 242);
    private static final Color NAV_BG = Color.WHITE;
    private static final Color BLUE_GRADIENT_START = new Color(107, 155, 246);
    private static final Color BLUE_GRADIENT_END = new Color(79, 109, 240);
    private static final Color ORANGE_GRADIENT_START = new Color(251, 191, 36);
    private static final Color ORANGE_GRADIENT_END = new Color(245, 158, 11);

    private JLabel consumptionValueLabel;
    private JLabel voltageValueLabel;
    private JLabel frequencyValueLabel;
    private JLabel costValueLabel;
    private Timer fetchTimer;

    public ElectricityDashboard() {
        setTitle("Electricity Dashboard");
        setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
        setSize(1400, 900);
        setLocationRelativeTo(null); // center the window 

        // Main panel with gradient background
        JPanel mainPanel = new JPanel() {
            @Override
            protected void paintComponent(Graphics g) {
                super.paintComponent(g);
                Graphics2D g2d = (Graphics2D) g;
                g2d.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
                GradientPaint gp = new GradientPaint(0, 0, new Color(246, 249, 252),
                        0, getHeight(), BG_COLOR);
                g2d.setPaint(gp);
                g2d.fillRect(0, 0, getWidth(), getHeight());
            }
        };
        mainPanel.setLayout(new BorderLayout(18, 18));
        mainPanel.setBorder(BorderFactory.createEmptyBorder(28, 28, 28, 28));

        // Left navigation
        JPanel leftNav = createLeftNav();
        mainPanel.add(leftNav, BorderLayout.WEST);

        // Main content area
        JPanel contentArea = new JPanel(new BorderLayout(18, 18));
        contentArea.setOpaque(false);

        // Top bar
        JPanel topBar = createTopBar();
        contentArea.add(topBar, BorderLayout.NORTH);

        // Grid content
        JPanel gridContent = createGridContent();
        contentArea.add(gridContent, BorderLayout.CENTER);

        mainPanel.add(contentArea, BorderLayout.CENTER);

        add(mainPanel);
        startDataFetching();
    }

    private JPanel createLeftNav() {
        JPanel nav = new JPanel();
        nav.setLayout(new BoxLayout(nav, BoxLayout.Y_AXIS));
        nav.setBackground(NAV_BG);
        nav.setBorder(new RoundedBorder(14));
        nav.setPreferredSize(new Dimension(72, 600));
        nav.setBorder(BorderFactory.createCompoundBorder(
                new RoundedBorder(14),
                BorderFactory.createEmptyBorder(16, 10, 16, 10)
        ));

        // Brand
        JLabel brand = new JLabel("EL", SwingConstants.CENTER);
        brand.setFont(new Font("Inter", Font.BOLD, 14));
        brand.setForeground(ACCENT_2);
        brand.setPreferredSize(new Dimension(48, 48));
        brand.setMaximumSize(new Dimension(48, 48));
        brand.setOpaque(true);
        brand.setBackground(new Color(163, 78, 242, 20));
        brand.setBorder(new RoundedBorder(10));
        brand.setAlignmentX(Component.CENTER_ALIGNMENT);

        nav.add(brand);
        nav.add(Box.createRigidArea(new Dimension(0, 18)));

        // Navigation buttons
        String[] icons = {"\uD83C\uDFE0", "\u26A1", "\uD83D\uDCCA", "\u2699\uFE0F"};
        String[] tooltips = {"Dashboard", "Consumption", "Reports", "Settings"};

        for (int i = 0; i < icons.length; i++) {
            JButton btn = createNavButton(icons[i], tooltips[i], i == 0);
            nav.add(btn);
            nav.add(Box.createRigidArea(new Dimension(0, 10)));
        }

        nav.add(Box.createVerticalGlue());

        // Help button
        JButton helpBtn = createNavButton("\u2753", "Help", false);
        nav.add(helpBtn);

        return nav;
    }

    private JButton createNavButton(String icon, String tooltip, boolean active) {
        JButton btn = new JButton(icon) {
            private boolean isActive = active;

            @Override
            protected void paintComponent(Graphics g) {
                Graphics2D g2d = (Graphics2D) g;
                g2d.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);

                if (isActive) {
                    g2d.setColor(new Color(107, 83, 245, 30));
                    g2d.fillRoundRect(0, 0, getWidth(), getHeight(), 12, 12);
                }

                super.paintComponent(g);
            }
        };

        btn.setPreferredSize(new Dimension(48, 48));
        btn.setMaximumSize(new Dimension(48, 48));
        btn.setFont(new Font("Segoe UI Emoji", Font.PLAIN, 20));
        btn.setForeground(active ? ACCENT_2 : new Color(85, 85, 85));
        btn.setFocusPainted(false);
        btn.setBorderPainted(false);
        btn.setContentAreaFilled(false);
        btn.setToolTipText(tooltip);
        btn.setCursor(new Cursor(Cursor.HAND_CURSOR));
        btn.setAlignmentX(Component.CENTER_ALIGNMENT);

        return btn;
    }

    private JPanel createTopBar() {
        JPanel topBar = new JPanel(new BorderLayout(16, 16));
        topBar.setBackground(CARD_COLOR);
        topBar.setBorder(BorderFactory.createCompoundBorder(
                new RoundedBorder(12),
                BorderFactory.createEmptyBorder(14, 18, 14, 18)
        ));

        // Title
        JLabel title = new JLabel("Electricity Dashboard");
        title.setFont(new Font("Inter", Font.BOLD, 16));
        title.setForeground(new Color(16, 33, 58));

        // Right side panel
        JPanel rightPanel = new JPanel(new FlowLayout(FlowLayout.RIGHT, 16, 0));
        rightPanel.setOpaque(false);

        // Search field
        JTextField searchField = new JTextField("Search anything...");
        searchField.setPreferredSize(new Dimension(300, 40));
        searchField.setFont(new Font("Inter", Font.PLAIN, 15));
        searchField.setForeground(MUTED_COLOR);
        searchField.setBorder(BorderFactory.createCompoundBorder(
                new RoundedBorder(12),
                BorderFactory.createEmptyBorder(8, 12, 8, 12)
        ));
        searchField.setBackground(new Color(249, 251, 255));

        searchField.addFocusListener(new FocusAdapter() {
            public void focusGained(FocusEvent e) {
                if (searchField.getText().equals("Search anything...")) {
                    searchField.setText("");
                    searchField.setForeground(Color.BLACK);
                }
            }

            public void focusLost(FocusEvent e) {
                if (searchField.getText().isEmpty()) {
                    searchField.setText("Search anything...");
                    searchField.setForeground(MUTED_COLOR);
                }
            }
        });

        searchField.addActionListener(e -> {
            String query = searchField.getText().trim();
            if (!query.isEmpty() && !query.equals("Search anything...")) {
                JOptionPane.showMessageDialog(this, "Search (mock): " + query);
            }
        });

        // Profile panel
        JPanel profilePanel = new JPanel(new FlowLayout(FlowLayout.RIGHT, 12, 0));
        profilePanel.setOpaque(false);

        JPanel textPanel = new JPanel(new GridLayout(2, 1));
        textPanel.setOpaque(false);
        JLabel hello = new JLabel("Hello,");
        hello.setFont(new Font("Inter", Font.PLAIN, 13));
        hello.setForeground(MUTED_COLOR);
        JLabel userName = new JLabel("New User");
        userName.setFont(new Font("Inter", Font.BOLD, 15));
        userName.setForeground(new Color(11, 18, 32));
        textPanel.add(hello);
        textPanel.add(userName);

        JLabel avatar = new JLabel("NU", SwingConstants.CENTER) {
            @Override
            protected void paintComponent(Graphics g) {
                Graphics2D g2d = (Graphics2D) g;
                g2d.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
                GradientPaint gp = new GradientPaint(0, 0, ACCENT_1, 0, getHeight(), ACCENT_2);
                g2d.setPaint(gp);
                g2d.fillRoundRect(0, 0, getWidth(), getHeight(), 12, 12);
                super.paintComponent(g);
            }
        };
        avatar.setPreferredSize(new Dimension(44, 44));
        avatar.setFont(new Font("Inter", Font.BOLD, 14));
        avatar.setForeground(Color.WHITE);
        avatar.setOpaque(false);

        profilePanel.add(textPanel);
        profilePanel.add(avatar);

        rightPanel.add(searchField);
        rightPanel.add(profilePanel);

        topBar.add(title, BorderLayout.WEST);
        topBar.add(rightPanel, BorderLayout.EAST);

        return topBar;
    }

    private JPanel createGridContent() {
        JPanel grid = new JPanel(new BorderLayout(20, 20));
        grid.setOpaque(false);

        // Left content
        JPanel leftContent = new JPanel();
        leftContent.setLayout(new BoxLayout(leftContent, BoxLayout.Y_AXIS));
        leftContent.setOpaque(false);

        // Top tiles
        JPanel topTiles = new JPanel(new GridLayout(1, 2, 18, 0));
        topTiles.setOpaque(false);
        topTiles.setMaximumSize(new Dimension(Integer.MAX_VALUE, 180));

        topTiles.add(createConsumptionTile());
        topTiles.add(createVoltageTile());

        leftContent.add(topTiles);
        leftContent.add(Box.createRigidArea(new Dimension(0, 18)));
        leftContent.add(createUsageCard());

        // Right sidebar
        JPanel rightSidebar = new JPanel();
        rightSidebar.setLayout(new BoxLayout(rightSidebar, BoxLayout.Y_AXIS));
        rightSidebar.setOpaque(false);
        rightSidebar.setPreferredSize(new Dimension(320, 600));

        rightSidebar.add(createSummaryCard());
        rightSidebar.add(Box.createRigidArea(new Dimension(0, 14)));
        rightSidebar.add(createPredictionCard());

        grid.add(leftContent, BorderLayout.CENTER);
        grid.add(rightSidebar, BorderLayout.EAST);

        return grid;
    }

    private JPanel createConsumptionTile() {
        JPanel tile = new JPanel() {
            @Override
            protected void paintComponent(Graphics g) {
                Graphics2D g2d = (Graphics2D) g;
                g2d.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
                GradientPaint gp = new GradientPaint(0, 0, BLUE_GRADIENT_START,
                        getWidth(), getHeight(), BLUE_GRADIENT_END);
                g2d.setPaint(gp);
                g2d.fillRoundRect(0, 0, getWidth(), getHeight(), 14, 14);
            }
        };
        tile.setLayout(new BorderLayout(12, 12));
        tile.setBorder(BorderFactory.createEmptyBorder(18, 18, 18, 18));
        tile.setOpaque(false);

        JPanel topSection = new JPanel();
        topSection.setLayout(new BoxLayout(topSection, BoxLayout.Y_AXIS));
        topSection.setOpaque(false);

        JLabel title = new JLabel("Today's Consumption");
        title.setFont(new Font("Inter", Font.BOLD, 14));
        title.setForeground(Color.WHITE);
        title.setAlignmentX(Component.LEFT_ALIGNMENT);

        consumptionValueLabel = new JLabel("22 kWh");
        consumptionValueLabel.setFont(new Font("Inter", Font.BOLD, 32));
        consumptionValueLabel.setForeground(Color.WHITE);
        consumptionValueLabel.setAlignmentX(Component.LEFT_ALIGNMENT);

        topSection.add(consumptionValueLabel);  // Use the stored reference

        JLabel sub = new JLabel("Current usage • Updated 10 min ago");
        sub.setFont(new Font("Inter", Font.PLAIN, 13));
        sub.setForeground(new Color(255, 255, 255, 240));
        sub.setAlignmentX(Component.LEFT_ALIGNMENT);

        topSection.add(title);
        topSection.add(Box.createRigidArea(new Dimension(0, 6)));
        topSection.add(consumptionValueLabel);
        topSection.add(Box.createRigidArea(new Dimension(0, 6)));
        topSection.add(sub);

        JPanel bottomSection = new JPanel(new FlowLayout(FlowLayout.LEFT, 20, 0));
        bottomSection.setOpaque(false);

        bottomSection.add(createStatLabel("Peak: 35 kWh"));
        bottomSection.add(createStatLabel("Avg: 18 kWh"));
        bottomSection.add(createStatLabel("Cost est.: ₱120.50"));

        tile.add(topSection, BorderLayout.NORTH);
        tile.add(bottomSection, BorderLayout.SOUTH);

        return tile;
    }

    private JPanel createVoltageTile() {
        JPanel tile = new JPanel() {
            @Override
            protected void paintComponent(Graphics g) {
                Graphics2D g2d = (Graphics2D) g;
                g2d.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
                GradientPaint gp = new GradientPaint(0, 0, ORANGE_GRADIENT_START,
                        getWidth(), getHeight(), ORANGE_GRADIENT_END);
                g2d.setPaint(gp);
                g2d.fillRoundRect(0, 0, getWidth(), getHeight(), 14, 14);
            }
        };
        tile.setLayout(new BorderLayout(12, 12));
        tile.setBorder(BorderFactory.createEmptyBorder(18, 18, 18, 18));
        tile.setOpaque(false);

        JPanel topSection = new JPanel();
        topSection.setLayout(new BoxLayout(topSection, BoxLayout.Y_AXIS));
        topSection.setOpaque(false);

        JLabel title = new JLabel("Voltage Stability");
        title.setFont(new Font("Inter", Font.BOLD, 14));
        title.setForeground(Color.WHITE);
        title.setAlignmentX(Component.LEFT_ALIGNMENT);

        voltageValueLabel = new JLabel("230 V");
        voltageValueLabel.setFont(new Font("Inter", Font.BOLD, 32));
        voltageValueLabel.setForeground(Color.WHITE);
        voltageValueLabel.setAlignmentX(Component.LEFT_ALIGNMENT);

        topSection.add(voltageValueLabel);

        JLabel sub = new JLabel("Nominal voltage • RMS");
        sub.setFont(new Font("Inter", Font.PLAIN, 13));
        sub.setForeground(new Color(255, 255, 255, 240));
        sub.setAlignmentX(Component.LEFT_ALIGNMENT);

        topSection.add(title);
        topSection.add(Box.createRigidArea(new Dimension(0, 6)));
        topSection.add(voltageValueLabel);
        topSection.add(Box.createRigidArea(new Dimension(0, 6)));
        topSection.add(sub);

        frequencyValueLabel = new JLabel("Frequency: 60 Hz");
        frequencyValueLabel.setFont(new Font("Inter", Font.PLAIN, 13));
        frequencyValueLabel.setForeground(Color.WHITE);

        tile.add(frequencyValueLabel, BorderLayout.SOUTH);

        tile.add(topSection, BorderLayout.NORTH);
        tile.add(frequencyValueLabel, BorderLayout.SOUTH);

        return tile;
    }

    private JLabel createStatLabel(String text) {
        JLabel label = new JLabel(text);
        label.setFont(new Font("Inter", Font.PLAIN, 13));
        label.setForeground(new Color(255, 255, 255, 240));
        return label;
    }

    private JPanel createUsageCard() {
        JPanel card = new JPanel();
        card.setLayout(new BoxLayout(card, BoxLayout.Y_AXIS));
        card.setBackground(CARD_COLOR);
        card.setBorder(BorderFactory.createCompoundBorder(
                new RoundedBorder(14),
                BorderFactory.createEmptyBorder(18, 18, 18, 18)
        ));
        card.setMaximumSize(new Dimension(Integer.MAX_VALUE, 350));

        JPanel header = new JPanel(new BorderLayout());
        header.setOpaque(false);
        JLabel title = new JLabel("How's the consumption today?");
        title.setFont(new Font("Inter", Font.BOLD, 15));
        JLabel period = new JLabel("Hourly • Daily • Weekly");
        period.setFont(new Font("Inter", Font.PLAIN, 13));
        period.setForeground(MUTED_COLOR);
        header.add(title, BorderLayout.WEST);
        header.add(period, BorderLayout.EAST);

        // Interactive chart panel
        InteractiveChartPanel chartPanel = new InteractiveChartPanel();
        chartPanel.setPreferredSize(new Dimension(800, 120));
        chartPanel.setMaximumSize(new Dimension(Integer.MAX_VALUE, 120));

        // Mini cards
        JPanel miniCards = new JPanel(new GridLayout(1, 3, 12, 0));
        miniCards.setOpaque(false);
        miniCards.setMaximumSize(new Dimension(Integer.MAX_VALUE, 80));

        miniCards.add(createMiniCard("Morning", "5 kWh"));
        miniCards.add(createMiniCard("Afternoon", "10 kWh"));
        miniCards.add(createMiniCard("Evening", "7 kWh"));

        card.add(header);
        card.add(Box.createRigidArea(new Dimension(0, 12)));
        card.add(chartPanel);
        card.add(Box.createRigidArea(new Dimension(0, 12)));
        card.add(miniCards);

        return card;
    }

    private JPanel createMiniCard(String label, String value) {
        JPanel mini = new JPanel();
        mini.setLayout(new BoxLayout(mini, BoxLayout.Y_AXIS));
        mini.setBackground(Color.WHITE);
        mini.setBorder(BorderFactory.createCompoundBorder(
                BorderFactory.createLineBorder(new Color(15, 23, 36, 10), 1, true),
                BorderFactory.createEmptyBorder(10, 10, 10, 10)
        ));

        JLabel labelText = new JLabel(label);
        labelText.setFont(new Font("Inter", Font.PLAIN, 13));
        labelText.setForeground(MUTED_COLOR);
        labelText.setAlignmentX(Component.CENTER_ALIGNMENT);

        JLabel valueText = new JLabel(value);
        valueText.setFont(new Font("Inter", Font.BOLD, 16));
        valueText.setAlignmentX(Component.CENTER_ALIGNMENT);

        mini.add(labelText);
        mini.add(Box.createRigidArea(new Dimension(0, 6)));
        mini.add(valueText);

        // Add hover effect
        mini.addMouseListener(new MouseAdapter() {
            @Override
            public void mouseEntered(MouseEvent e) {
                mini.setBackground(new Color(249, 251, 255));
                mini.setBorder(BorderFactory.createCompoundBorder(
                        BorderFactory.createLineBorder(ACCENT_1, 2, true),
                        BorderFactory.createEmptyBorder(9, 9, 9, 9)
                ));
            }

            @Override
            public void mouseExited(MouseEvent e) {
                mini.setBackground(Color.WHITE);
                mini.setBorder(BorderFactory.createCompoundBorder(
                        BorderFactory.createLineBorder(new Color(15, 23, 36, 10), 1, true),
                        BorderFactory.createEmptyBorder(10, 10, 10, 10)
                ));
            }
        });

        return mini;
    }

    private JPanel createSummaryCard() {
        JPanel card = new JPanel();
        card.setLayout(new BoxLayout(card, BoxLayout.Y_AXIS));
        card.setBackground(new Color(248, 250, 252));
        card.setBorder(BorderFactory.createCompoundBorder(
                BorderFactory.createLineBorder(new Color(15, 23, 36, 8), 1, true),
                BorderFactory.createEmptyBorder(12, 12, 12, 12)
        ));
        card.setMaximumSize(new Dimension(320, 150));

        JPanel header = new JPanel(new BorderLayout());
        header.setOpaque(false);

        JPanel leftSection = new JPanel();
        leftSection.setLayout(new BoxLayout(leftSection, BoxLayout.Y_AXIS));
        leftSection.setOpaque(false);

        JLabel title = new JLabel("Summary");
        title.setFont(new Font("Inter", Font.BOLD, 14));
        title.setAlignmentX(Component.LEFT_ALIGNMENT);

        JLabel subtitle = new JLabel("Total today");
        subtitle.setFont(new Font("Inter", Font.PLAIN, 13));
        subtitle.setForeground(MUTED_COLOR);
        subtitle.setAlignmentX(Component.LEFT_ALIGNMENT);

        leftSection.add(title);
        leftSection.add(Box.createRigidArea(new Dimension(0, 6)));
        leftSection.add(subtitle);

        JPanel rightSection = new JPanel();
        rightSection.setLayout(new BoxLayout(rightSection, BoxLayout.Y_AXIS));
        rightSection.setOpaque(false);

        JLabel value = new JLabel("22 kWh");
        value.setFont(new Font("Inter", Font.BOLD, 20));
        value.setAlignmentX(Component.RIGHT_ALIGNMENT);

        JLabel peak = new JLabel("Peak 6:00 PM");
        peak.setFont(new Font("Inter", Font.PLAIN, 13));
        peak.setForeground(MUTED_COLOR);
        peak.setAlignmentX(Component.RIGHT_ALIGNMENT);

        rightSection.add(value);
        rightSection.add(peak);

        header.add(leftSection, BorderLayout.WEST);
        header.add(rightSection, BorderLayout.EAST);

        JLabel note = new JLabel("<html>Based on real-time meter readings. Values are illustrative.</html>");
        note.setFont(new Font("Inter", Font.PLAIN, 13));
        note.setForeground(MUTED_COLOR);

        card.add(header);
        card.add(Box.createRigidArea(new Dimension(0, 12)));
        card.add(note);

        return card;
    }

    private JPanel createPredictionCard() {
        JPanel card = new JPanel();
        card.setLayout(new BoxLayout(card, BoxLayout.Y_AXIS));
        card.setBackground(new Color(248, 250, 252));
        card.setBorder(BorderFactory.createCompoundBorder(
                BorderFactory.createLineBorder(new Color(15, 23, 36, 8), 1, true),
                BorderFactory.createEmptyBorder(12, 12, 12, 12)
        ));
        card.setMaximumSize(new Dimension(320, 200));

        JPanel header = new JPanel(new BorderLayout());
        header.setOpaque(false);

        JLabel title = new JLabel("Predictions");
        title.setFont(new Font("Inter", Font.BOLD, 14));

        JLabel model = new JLabel("Model: Basic");
        model.setFont(new Font("Inter", Font.PLAIN, 13));
        model.setForeground(MUTED_COLOR);

        header.add(title, BorderLayout.WEST);
        header.add(model, BorderLayout.EAST);

        JPanel predRow = new JPanel(new GridLayout(1, 2, 10, 0));
        predRow.setOpaque(false);
        predRow.setMaximumSize(new Dimension(Integer.MAX_VALUE, 80));

        predRow.add(createPredBox("Tomorrow", "25 kWh"));
        predRow.add(createPredBox("Next Week", "170 kWh"));

        JLabel note = new JLabel("<html>Use the search to find devices, meters, or reports.</html>");
        note.setFont(new Font("Inter", Font.PLAIN, 13));
        note.setForeground(MUTED_COLOR);

        card.add(header);
        card.add(Box.createRigidArea(new Dimension(0, 10)));
        card.add(predRow);
        card.add(Box.createRigidArea(new Dimension(0, 10)));
        card.add(note);

        return card;
    }

    private JPanel createPredBox(String label, String value) {
        JPanel box = new JPanel();
        box.setLayout(new BoxLayout(box, BoxLayout.Y_AXIS));
        box.setBackground(Color.WHITE);
        box.setBorder(BorderFactory.createCompoundBorder(
                BorderFactory.createLineBorder(new Color(15, 23, 36, 8), 1, true),
                BorderFactory.createEmptyBorder(10, 10, 10, 10)
        ));

        JLabel labelText = new JLabel(label);
        labelText.setFont(new Font("Inter", Font.PLAIN, 13));
        labelText.setForeground(MUTED_COLOR);
        labelText.setAlignmentX(Component.CENTER_ALIGNMENT);

        JLabel valueText = new JLabel(value);
        valueText.setFont(new Font("Inter", Font.BOLD, 16));
        valueText.setAlignmentX(Component.CENTER_ALIGNMENT);

        box.add(labelText);
        box.add(Box.createRigidArea(new Dimension(0, 6)));
        box.add(valueText);

        return box;
    }

    // Interactive chart with tooltips
    class InteractiveChartPanel extends JPanel {

        private int[] dataPoints = {25, 21, 38, 42, 55, 78, 92, 65, 48};
        private String[] labels = {"12AM", "3AM", "6AM", "9AM", "12PM", "3PM", "6PM", "9PM", "11PM"};
        private int hoveredIndex = -1;
        private JLabel tooltipLabel;

        public InteractiveChartPanel() {
            setOpaque(false);
            setLayout(null);

            tooltipLabel = new JLabel();
            tooltipLabel.setFont(new Font("Inter", Font.BOLD, 12));
            tooltipLabel.setForeground(ACCENT_1);
            tooltipLabel.setVisible(false);
            tooltipLabel.setBorder(BorderFactory.createCompoundBorder(
                    BorderFactory.createLineBorder(new Color(107, 83, 245, 50), 2, true),
                    BorderFactory.createEmptyBorder(8, 12, 8, 12)
            ));
            tooltipLabel.setBackground(new Color(255, 255, 255, 250));
            tooltipLabel.setOpaque(true);
            add(tooltipLabel);

            addMouseMotionListener(new MouseMotionAdapter() {
                @Override
                public void mouseMoved(MouseEvent e) {
                    int width = getWidth();
                    int height = getHeight();
                    int segments = dataPoints.length - 1;

                    for (int i = 0; i < dataPoints.length; i++) {
                        int x = (width * i) / segments;
                        int y = height - (dataPoints[i] * height / 100);

                        if (Math.abs(e.getX() - x) < 20 && Math.abs(e.getY() - y) < 20) {
                            hoveredIndex = i;
                            tooltipLabel.setText("<html><center>" + labels[i] + "<br><b>"
                                    + (dataPoints[i] / 10.0) + " kWh</b><br><small>Consumption</small></center></html>");
                            tooltipLabel.setVisible(true);
                            tooltipLabel.setBounds(Math.max(0, Math.min(x - 50, width - 120)),
                                    Math.max(0, y - 70), 100, 60);
                            repaint();
                            return;
                        }
                    }

                    if (hoveredIndex != -1) {
                        hoveredIndex = -1;
                        tooltipLabel.setVisible(false);
                        repaint();
                    }
                }
            });

            addMouseListener(new MouseAdapter() {
                @Override
                public void mouseExited(MouseEvent e) {
                    hoveredIndex = -1;
                    tooltipLabel.setVisible(false);
                    repaint();
                }
            });
        }

        @Override
        protected void paintComponent(Graphics g) {
            super.paintComponent(g);
            Graphics2D g2d = (Graphics2D) g;
            g2d.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);

            int width = getWidth();
            int height = getHeight();
            int segments = dataPoints.length - 1;

            // Draw gradient fill
            Path2D.Double path = new Path2D.Double();
            path.moveTo(0, height);

            for (int i = 0; i < dataPoints.length; i++) {
                int x = (width * i) / segments;
                int y = height - (dataPoints[i] * height / 100);
                if (i == 0) {
                    path.lineTo(x, y);
                } else {
                    path.lineTo(x, y);
                }
            }

            path.lineTo(width, height);
            path.closePath();

            GradientPaint gradient = new GradientPaint(0, 0, new Color(107, 83, 245, 76),
                    0, height, new Color(107, 83, 245, 3));
            g2d.setPaint(gradient);
            g2d.fill(path);

            // Draw line
            g2d.setStroke(new BasicStroke(3, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
            g2d.setColor(ACCENT_1);

            for (int i = 0; i < dataPoints.length - 1; i++) {
                int x1 = (width * i) / segments;
                int y1 = height - (dataPoints[i] * height / 100);
                int x2 = (width * (i + 1)) / segments;
                int y2 = height - (dataPoints[i + 1] * height / 100);
                g2d.drawLine(x1, y1, x2, y2);
            }

            // Draw points
            for (int i = 0; i < dataPoints.length; i++) {
                int x = (width * i) / segments;
                int y = height - (dataPoints[i] * height / 100);

                if (i == hoveredIndex) {
                    g2d.setColor(Color.WHITE);
                    g2d.fillOval(x - 6, y - 6, 12, 12);
                    g2d.setColor(ACCENT_1);
                    g2d.setStroke(new BasicStroke(3));
                    g2d.drawOval(x - 6, y - 6, 12, 12);
                } else {
                    g2d.setColor(Color.WHITE);
                    g2d.fillOval(x - 4, y - 4, 8, 8);
                    g2d.setColor(ACCENT_1);
                    g2d.setStroke(new BasicStroke(2));
                    g2d.drawOval(x - 4, y - 4, 8, 8);
                }
            }
        }
    }

    // Custom rounded border class
    static class RoundedBorder extends AbstractBorder {

        private int radius;

        RoundedBorder(int radius) {
            this.radius = radius;
        }

        @Override
        public void paintBorder(Component c, Graphics g, int x, int y, int width, int height) {
            Graphics2D g2d = (Graphics2D) g;
            g2d.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g2d.setColor(new Color(15, 23, 36, 15));
            g2d.drawRoundRect(x, y, width - 1, height - 1, radius, radius);
        }

        @Override
        public Insets getBorderInsets(Component c) {
            return new Insets(radius / 2, radius / 2, radius / 2, radius / 2);
        }

        @Override
        public Insets getBorderInsets(Component c, Insets insets) {
            insets.left = insets.right = insets.top = insets.bottom = radius / 2;
            return insets;
        }
    }

    private void startDataFetching() {
        fetchTimer = new Timer(5000, e -> fetchData());
        fetchTimer.start();
        fetchData();
    }

    private void fetchData() {
        new Thread(() -> {
            try {
                URL url = new URL("http://localhost:3000/api/power-data");
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(5000);
                conn.setReadTimeout(5000);

                if (conn.getResponseCode() == 200) {
                    BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                    StringBuilder response = new StringBuilder();
                    String line;
                    while ((line = reader.readLine()) != null) {
                        response.append(line);
                    }
                    reader.close();

                    JSONObject json = new JSONObject(response.toString());
                    updateUI(json);
                }
            } catch (Exception e) {
                System.err.println("Error fetching data: " + e.getMessage());
            }
        }).start();
    }

    private void updateUI(JSONObject data) {
        SwingUtilities.invokeLater(() -> {
            try {
                double energy = data.getDouble("energy");
                double voltage = data.getDouble("voltage");
                double frequency = data.getDouble("frequency");
                double cost = energy * 5.5;

                System.out.println("=== DATA RECEIVED ===");
                System.out.println("Energy: " + energy);
                System.out.println("Voltage: " + voltage);
                System.out.println("Frequency: " + frequency);

                if (consumptionValueLabel != null) {
                    System.out.println("Updating consumption label to: " + String.format("%.2f kWh", energy));
                    consumptionValueLabel.setText(String.format("%.2f kWh", energy));
                } else {
                    System.out.println("ERROR: consumptionValueLabel is NULL");
                }

                if (voltageValueLabel != null) {
                    System.out.println("Updating voltage label to: " + String.format("%.1f V", voltage));
                    voltageValueLabel.setText(String.format("%.1f V", voltage));
                } else {
                    System.out.println("ERROR: voltageValueLabel is NULL");
                }

                if (frequencyValueLabel != null) {
                    System.out.println("Updating frequency label to: " + String.format("Frequency: %.1f Hz", frequency));
                    frequencyValueLabel.setText(String.format("Frequency: %.1f Hz", frequency));
                } else {
                    System.out.println("ERROR: frequencyValueLabel is NULL");
                }

            } catch (Exception e) {
                System.err.println("Error updating UI: " + e.getMessage());
                e.printStackTrace();
            }
        });
    }

    public static void main(String[] args) {
        SwingUtilities.invokeLater(() -> {
            try {
                UIManager.setLookAndFeel(UIManager.getSystemLookAndFeelClassName());
            } catch (Exception e) {
                e.printStackTrace();
            }

            ElectricityDashboard dashboard = new ElectricityDashboard();
            dashboard.setVisible(true);
        });
    }
}
